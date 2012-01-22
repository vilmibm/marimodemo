marimo.widgetlib.medley_comments = marimo.extend(marimo.widgetlib.request_widget, {
    init: function (data) {
        this.id = data.id;
        this.murl = data.murl;
        this.data = data;

        var qs = cmg.parse_qs(window.location.search);
        var target_page = (qs['cpage'] || this.data.kwargs.page);
        var highlight = (qs['cid'] || this.data.kwargs.highlight);

        this.data.kwargs.page = target_page;
        this.data.kwargs.highlight = highlight;

        this.add_request();

        this.on('comments_loaded', function() {
            this.setup_pagination();
            this.setup_edit_links();
            this.setup_events();
            marimo.$('#comments').fadeIn(500, this.setup_permalinks);
        });

        return this;
    },
    refresh: function () {
        // TODO this is hateful, but needed. otherwise you will never see removed comments.
        this.data.context = {cache_bust:String(Math.random()).substr(3,5)};
        this.add_request();
        marimo.make_request();
    },
    edit: function () {
        // TODO
    },
    post: function () {
        var data = {
            bid: marimo.$('#cmSubmitComment input[name=bid]').attr('value'),
            text: marimo.$('#cmCommentField').attr('value')
        };
        // UITODO handle lack of text
        marimo.$.ajax({
            url:'/medley-comments/post/',
            type:'POST',
            data:data,
            dataType:'json',
            context:this,
            success: function(data) {
                if (!data.cpage || !data.cid) {
                    return handle_post_comment_error.call(this, {status:500, msg:'missing_data'});
                }
                this.data.kwargs.page = data['cpage'];
                this.data.kwargs.highlight = data['cid'];
                this.refresh();
            },
            error: this.handle_ajax_error
        });
    },
    suggest_removal: function (e) {
        var cid = marimo.$(e.target).attr('data-cid');
        if (!cid) return console.error('panic: no comment id in suggest_removal');
        marimo.$.ajax({
            url:marimo.printf('/medley-comments/report_form/%s/', [cid]),
            type:'GET',
            context: this,
            success: function(data) {
                var abuse_form = marimo.widgets.comments_abuse;
                if (!abuse_form) {
                    marimo.add_widget(data.widget_args);
                    abuse_form = marimo.widgets.comments_abuse;
                    abuse_form.render();
                    console.log('called render');
                } else {
                    abuse_form.update(data.widget_args);
                    console.log(abuse_form);
                    abuse_form.render();
                }

                abuse_form.open();

                this.on(marimo.printf('%s_removed', [cid]), this.refresh);
            },
            error: this.handle_ajax_error
        });
    },
    older: function () {this.change_page(-1);},
    newer: function () {this.change_page(1);},
    change_page: function (direction) {
        this.data.kwargs.page = this.data.kwargs.page + direction;
        this.refresh();
    },
    handle_ajax_error: function (data) {
        var error = marimo.widgetlib.request_widget.handle_ajax_error.call(this, data);
        if (error.status === 500) {
            // UITODO pop up a standard "please try again" sort of thing
        }
    },
    setup_edit_links: function () {
        var current_user = cmg.get_cookie('ur_name');
        if (!current_user) return;
        // TODO is this fast enough?
        marimo.$('#comments div.cmListItem[data-poster="'+current_user+'"] li.edit').each(function() {
            var submitted = Number($(this).attr('data-submitted'));
            var now = Date.now() / 1000;
            if ((now-submitted < (15*60))) marimo.$(this).show();
        });
    },
    setup_permalink: function () {
        // we only want to do this once. we don't want to mess with
        // the comments display as the user pages, it will confuse
        // them. so guard the permalink code so it just runs on first
        // render.
        if (this.permalink_guard) { return; }
        var cid = this.data.kwargs.highlight;
        if (!cid) { return; }
        marimo.$('#comments div.cmListItem').each(function() {
            if (cid === marimo.$(this).attr('id')) {
                // TODO architect with classes. and stuff.
                marimo.$(function(){marimo.$('html, body').animate({'scrollTop':marimo.$('#'+cid).offset().top}, 1000)});
                marimo.$('#'+cid).css('background', 'rgb(189, 232, 255)');
                return false;
            }
        });
        this.permalink_guard = true;
    },
    setup_pagination: function () {
        var num_pages = this.data.context.num_pages;
        var page = this.data.context.page;

        var both = (num_pages > 1 && page > 1 && page !== num_pages);
        var just_older = (num_pages > 1 && page === num_pages);
        var just_newer = (num_pages > 1 && page === 1);

        var $older = marimo.$('#comments div.pagination a.older');
        var $newer = marimo.$('#comments div.pagination a.newer');

        if (both) {
            $older.show();
            $newer.show();
        }
        if (just_older) $older.show();
        if (just_newer) $newer.show();
    },
    setup_events: function () {
        this.domwire([
            {
                event:'click',
                selector:'#comments .suggest_removal',
                cb:this.suggest_removal
            },
            {
                event:'submit',
                selector:'#cmSubmitComment',
                cb:this.post
            },
            {
                event:'click',
                selector:'TODO edit <a>',
                cb:this.edit
            },
            {
                event:'click',
                selector:'#comments div.pagination a.older',
                cb:this.older
            },
            {
                event:'click',
                selector:'#comments div.pagination a.newer',
                cb:this.newer
            }
        ]);
    }
});
