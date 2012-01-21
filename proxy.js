var http = require('http');

http.createServer(function(req, res) {
    console.log('hi there.');
    var options = {
        host:'api.twitter.com',
        port: 80,
        path: '/1/statuses/public_timeline.json?count=10&include_entities=true'
    };
    http.get(options, function(twitres) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        twitres.pipe(res);
    });
}).listen(8001, 'borges.cei.cox.com');
