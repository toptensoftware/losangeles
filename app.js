// Imports
var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var la = require('./losangeles.js');
var app = express();
var moe = require('moe-js');
var lessMiddleware = require('less-middleware');
var fs = require('fs');

// Work out the content root
var contentRoot = process.env.LOSANGELES_CONTENT_ROOT || process.cwd();
var publicRoot = path.join(contentRoot, 'public');

// Read hooks file
var hooks;
if (fs.existsSync(path.join(contentRoot, "losangeles-hooks.js")))
{
    hooks = require(path.join(contentRoot, "losangeles-hooks.js"));
}

// view engine setup
app.engine('moe', moe.express(app));
app.set('views', path.join(contentRoot, 'views'));
app.set('view engine', 'moe');

// Middleware handlers
app.use(favicon(path.join(publicRoot, 'favicon.ico')));
app.use(logger('dev'));
app.use(lessMiddleware(publicRoot, { render: { compress: false } } ));
app.use(express.static(publicRoot));
app.use('/codestyles', express.static(path.join(__dirname, 'node_modules/highlight.js/styles')));

// Create the main LA server
var laServer = la.serve({
    contentPath: publicRoot,
});

// Run redirect rules
if (hooks.urlRules)
{
    app.use(la.urlRules(hooks.urlRules));
}

// Pre hooks
if (hooks.middlewarePre)
{
    app.use(hooks.middlewarePre(laServer));
}

// Main content server
app.use(laServer);

// Error handling

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
