""" medley.medley_comments.views """
from django.core.paginator import Paginator, EmptyPage
from marimo.views.base import BaseWidget
from marimo.template_loader import template_loader

COMMENTS_PER_PAGE = 20
EDIT_EXPIRATION = 15


class CommentsWidget(BaseWidget):
    template = template_loader.load('medley_comments.html')

    def cache_key(self, *args, **kwargs):
        ''' args should be content_type_id, object_id '''
        site_id = kwargs.get('site_id', settings.SITE_ID)
        page = kwargs.get('page', 1)

        return 'medley_comments:%s:%s:%s:%s' % (site_id, args[0], args[1], page)

    def cacheable(self, response, *args, **kwargs):
        # fill context with vars for mustache templates
        content_type_id = args[0]
        object_id = args[1]
        site_id = kwargs.get('site_id', settings.SITE_ID)
        page = kwargs.get('page', 1)

        # good for debugging:
        # print "ct %s oid %s sid %s page %s" % (content_type_id, object_id, site_id, page)

        ct = ContentType.objects.get(pk=content_type_id)
        site = Site.objects.get(pk=site_id)

        bucket = MedleyCommentBucket.objects.get(content_type=ct, object_id=object_id, originating_site=site)
        comments = MedleyComment.objects.select_related('user').filter(bucket=bucket)
        pages = Paginator(comments, COMMENTS_PER_PAGE)
        try:
            comments = pages.page(page).object_list
        except EmptyPage:
            # fall back to last page if page past end requested
            comments = pages.page(pages.end_index).object_list

        # start preparing data. There are lots of little nagging conditions
        # that go into showing comments. I've tried to decompose them into
        # lambdas rather than write gnarly nested conditionals with lots of
        # temp vars.
        removed_text = 'This comment has been removed for violation of the usage agreement.'
        gp      = lambda u: u.get_profile()
        poster  = lambda c: (gp(c.user).screen_name or c.user.username)
        visible = lambda c: ContentStatus.objects.visible(c)
        text    = lambda c: c.text if visible(c) else removed_text
        def avatar_href(comment):
            ''' User -> String image_href
                Handles mogrification, suppressed avatar, and social avatar
                logic. falls back to blank avatar gif.
            '''
            u = comment.user
            # calling gp a lot looks bad, but internally User objects cache their
            # profiles in memory for repeated calls.
            suppressed = lambda u: gp(u).supress_avatar
            empty = lambda u: '%sweb/common/images/avatars/blank_avatar.gif' % settings.MEDLEY_MEDIA_URL

            if suppressed(u):
                return empty(u)

            mog = lambda h: Mogrifier(h, [('resize', '48x48')], {}).mogrify()
            avatar = lambda u: mog(gp(u).avatar.url)
            soc_avatar = lambda u: gp(u).social_avatar

            try:
                return avatar(u)
            except ValueError:
                pass

            return soc_avatar(u) or empty(u)

        response['context']['comments'] = [{
            # src attr for avatar
            'avatar_href':avatar_href(c),
            # href of permalink to poster's profile
            'poster_href': c.user.get_profile().get_absolute_url(),
            # href of permalink to comment
            'comment_href': c.get_absolute_url(page),
            # href of ajax view for editing this comment
            'edit_href': reverse(edit),
            # href of ajax view for editing this comment
            'flag_href': reverse(flag_or_remove),
            # screen_name or username of poster.
            'poster':poster(c),
            # date comment was submitted
            'submit_date':str(c.submit_date),
            # date comment was submitted in timestamp
            'submitted_ts':int(c.submit_date.strftime('%s')),
            # text of comment
            'text':text(c),
            # comment's id for anchoring
            'comment_id':c.pk,
            # update UI for filtered comments
            'visible': visible(c),
        } for c in comments]

        # total pages (also last page since 1 indexed)
        response['context']['num_pages'] = pages.num_pages
        # current page, 1-indexed
        response['context']['page'] = int(page)
        # used to reference in comment post form
        response['context']['bid'] = bucket.id

        return response

    def uncacheable(self, request, response, *args, **kwargs):
        # no-op. and god willing it will remain so.
        return response

    def regenerate_last_page(self, bucket):
        content_type_id = bucket.content_type.id
        object_id = bucket.object_id
        site_id = bucket.originating_site_id

        comments = MedleyComment.objects.filter(bucket=bucket)
        num_pages = Paginator(comments, COMMENTS_PER_PAGE).num_pages

        return self.regenerate_page_for_bucket(bucket, num_pages)

    def regenerate_page_for_comment(self, comment):
        comments_up_to = MedleyComment.objects.filter(submit_date__lte=comment.submit_date, bucket=comment.bucket)
        page_index = Paginator(comments_up_to, COMMENTS_PER_PAGE).num_pages

        return self.regenerate_page_for_bucket(comment.bucket, page_index)

    def regenerate_page_for_bucket(self, bucket, page):
        content_type_id = bucket.content_type.id
        object_id = bucket.object_id
        site_id = bucket.originating_site_id

        args = [content_type_id, object_id]
        kwargs = {'site_id':site_id, 'page':page}

        self.update_cache(None, *args, **kwargs)

        return page

    def flag(self, user, comment, reason):
        if not Flag.can_flag_thing(user, comment):
            raise Exception('no_permission')

        Flag.objects.create(owner=user, content_object=comment, reason=reason)

    def remove(self, user, comment):
        status = ContentStatus.objects.get(object_pk=comment.pk, content_type=ContentType.objects.get_for_model(comment))
        #status.event(user, 'removed')
        status.event(user, 'reject')
