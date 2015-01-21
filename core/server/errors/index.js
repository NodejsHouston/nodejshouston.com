/*jslint regexp: true */
var _                          = require('lodash'),
    colors                     = require('colors'),
    path                       = require('path'),
    Promise                    = require('bluebird'),
    hbs                        = require('express-hbs'),
    NotFoundError              = require('./not-found-error'),
    BadRequestError            = require('./bad-request-error'),
    InternalServerError        = require('./internal-server-error'),
    NoPermissionError          = require('./no-permission-error'),
    RequestEntityTooLargeError = require('./request-too-large-error'),
    UnauthorizedError          = require('./unauthorized-error'),
    ValidationError            = require('./validation-error'),
    UnsupportedMediaTypeError  = require('./unsupported-media-type-error'),
    EmailError                 = require('./email-error'),
    DataImportError            = require('./data-import-error'),
    config,
    errors,

    // Paths for views
    userErrorTemplateExists   = false;

// This is not useful but required for jshint
colors.setTheme({silly: 'rainbow'});

// Shim right now to deal with circular dependencies.
// @TODO(hswolff): remove circular dependency and lazy require.
function getConfigModule() {
    if (!config) {
        config = require('../config');
    }

    return config;
}

/**
 * Basic error handling helpers
 */
errors = {
    updateActiveTheme: function (activeTheme) {
        userErrorTemplateExists = getConfigModule().paths.availableThemes[activeTheme].hasOwnProperty('error.hbs');
    },

    throwError: function (err) {
        if (!err) {
            err = new Error('An error occurred');
        }

        if (_.isString(err)) {
            throw new Error(err);
        }

        throw err;
    },

    // ## Reject Error
    // Used to pass through promise errors when we want to handle them at a later time
    rejectError: function (err) {
        return Promise.reject(err);
    },

    logInfo: function (component, info) {
        if ((process.env.NODE_ENV === 'development' ||
            process.env.NODE_ENV === 'staging' ||
            process.env.NODE_ENV === 'production')) {
            var msg = [component.cyan + ':'.cyan, info.cyan];

            console.info.apply(console, msg);
        }
    },

    logWarn: function (warn, context, help) {
        if ((process.env.NODE_ENV === 'development' ||
            process.env.NODE_ENV === 'staging' ||
            process.env.NODE_ENV === 'production')) {
            warn = warn || 'no message supplied';
            var msgs = ['\nWarning:'.yellow, warn.yellow, '\n'];

            if (context) {
                msgs.push(context.white, '\n');
            }

            if (help) {
                msgs.push(help.green);
            }

            // add a new line
            msgs.push('\n');

            console.log.apply(console, msgs);
        }
    },

    logError: function (err, context, help) {
        var self = this,
            origArgs = _.toArray(arguments).slice(1),
            stack,
            msgs;

        if (_.isArray(err)) {
            _.each(err, function (e) {
                var newArgs = [e].concat(origArgs);
                errors.logError.apply(self, newArgs);
            });
            return;
        }

        stack = err ? err.stack : null;

        if (!_.isString(err)) {
            if (_.isObject(err) && _.isString(err.message)) {
                err = err.message;
            } else {
                err = 'An unknown error occurred.';
            }
        }

        // Overwrite error to provide information that this is probably a permission problem
        // TODO: https://github.com/TryGhost/Ghost/issues/3687
        if (err.indexOf('SQLITE_READONLY') !== -1) {
            context = 'Your database is in read only mode. Visitors can read your blog, but you can\'t log in or add posts.';
            help = 'Check your database file and make sure that file owner and permissions are correct.';
        }
        // TODO: Logging framework hookup
        // Eventually we'll have better logging which will know about envs
        if ((process.env.NODE_ENV === 'development' ||
            process.env.NODE_ENV === 'staging' ||
            process.env.NODE_ENV === 'production')) {
            msgs = ['\nERROR:'.red, err.red, '\n'];

            if (context) {
                msgs.push(context.white, '\n');
            }

            if (help) {
                msgs.push(help.green);
            }

            // add a new line
            msgs.push('\n');

            if (stack) {
                msgs.push(stack, '\n');
            }

            console.error.apply(console, msgs);
        }
    },

    logErrorAndExit: function (err, context, help) {
        this.logError(err, context, help);
        // Exit with 0 to prevent npm errors as we have our own
        process.exit(0);
    },

    logAndThrowError: function (err, context, help) {
        this.logError(err, context, help);

        this.throwError(err, context, help);
    },

    logAndRejectError: function (err, context, help) {
        this.logError(err, context, help);

        return this.rejectError(err, context, help);
    },

    logErrorWithRedirect: function (msg, context, help, redirectTo, req, res) {
        /*jshint unused:false*/
        var self = this;

        return function () {
            self.logError(msg, context, help);

            if (_.isFunction(res.redirect)) {
                res.redirect(redirectTo);
            }
        };
    },

    handleAPIError: function (error, permsMessage) {
        if (!error) {
            return this.rejectError(
                new this.NoPermissionError(permsMessage || 'You do not have permission to perform this action')
            );
        }

        if (_.isString(error)) {
            return this.rejectError(new this.NoPermissionError(error));
        }

        if (error.type) {
            return this.rejectError(error);
        }

        return this.rejectError(new this.InternalServerError(error));
    },

    renderErrorPage: function (code, err, req, res, next) {
        /*jshint unused:false*/
        var self = this,
            defaultErrorTemplatePath = path.resolve(getConfigModule().paths.adminViews, 'user-error.hbs');

        function parseStack(stack) {
            if (!_.isString(stack)) {
                return stack;
            }

            // TODO: split out line numbers
            var stackRegex = /\s*at\s*(\w+)?\s*\(([^\)]+)\)\s*/i;

            return (
                stack
                    .split(/[\r\n]+/)
                    .slice(1)
                    .map(function (line) {
                        var parts = line.match(stackRegex);
                        if (!parts) {
                            return null;
                        }

                        return {
                            function: parts[1],
                            at: parts[2]
                        };
                    })
                    .filter(function (line) {
                        return !!line;
                    })
            );
        }

        // Render the error!
        function renderErrorInt(errorView) {
            var stack = null;

            if (process.env.NODE_ENV !== 'production' && err.stack) {
                stack = parseStack(err.stack);
            }

            res.status(code).render((errorView || 'error'), {
                message: err.message || err,
                code: code,
                stack: stack
            }, function (templateErr, html) {
                if (!templateErr) {
                    return res.status(code).send(html);
                }
                // There was an error trying to render the error page, output the error
                self.logError(templateErr, 'Error whilst rendering error page', 'Error template has an error');

                // And then try to explain things to the user...
                // Cheat and output the error using handlebars escapeExpression
                return res.status(500).send(
                    '<h1>Oops, seems there is an an error in the error template.</h1>' +
                    '<p>Encountered the error: </p>' +
                    '<pre>' + hbs.handlebars.Utils.escapeExpression(templateErr.message || templateErr) + '</pre>' +
                    '<br ><p>whilst trying to render an error page for the error: </p>' +
                    code + ' ' + '<pre>'  + hbs.handlebars.Utils.escapeExpression(err.message || err) + '</pre>'
                );
            });
        }

        if (code >= 500) {
            this.logError(err, 'Rendering Error Page', 'Ghost caught a processing error in the middleware layer.');
        }

        // Are we admin? If so, don't worry about the user template
        if ((res.isAdmin && req.user && req.user.id) || userErrorTemplateExists === true) {
            return renderErrorInt();
        }

        // We're not admin and the template doesn't exist. Render the default.
        return renderErrorInt(defaultErrorTemplatePath);
    },

    error404: function (req, res, next) {
        var message = res.isAdmin && req.user ? 'No Ghost Found' : 'Page Not Found';

        // do not cache 404 error
        res.set({'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'});
        if (req.method === 'GET') {
            this.renderErrorPage(404, message, req, res, next);
        } else {
            res.status(404).send(message);
        }
    },

    error500: function (err, req, res, next) {
        // 500 errors should never be cached
        res.set({'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'});

        if (err.status === 404) {
            return this.error404(req, res, next);
        }

        if (req.method === 'GET') {
            if (!err || !(err instanceof Error)) {
                next();
            }
            errors.renderErrorPage(err.status || 500, err, req, res, next);
        } else {
            var statusCode = 500,
                returnErrors = [];

            if (!_.isArray(err)) {
                err = [].concat(err);
            }

            _.each(err, function (errorItem) {
                var errorContent = {};

                statusCode = errorItem.code || 500;

                errorContent.message = _.isString(errorItem) ? errorItem :
                    (_.isObject(errorItem) ? errorItem.message : 'Unknown Error');
                errorContent.type = errorItem.type || 'InternalServerError';
                returnErrors.push(errorContent);
            });

            res.status(statusCode).json({errors: returnErrors});
        }
    }
};

// Ensure our 'this' context for methods and preserve method arity by
// using Function#bind for expressjs
_.each([
    'logWarn',
    'logInfo',
    'rejectError',
    'throwError',
    'logError',
    'logAndThrowError',
    'logAndRejectError',
    'logErrorAndExit',
    'logErrorWithRedirect',
    'handleAPIError',
    'renderErrorPage',
    'error404',
    'error500'
], function (funcName) {
    errors[funcName] = errors[funcName].bind(errors);
});

module.exports                            = errors;
module.exports.NotFoundError              = NotFoundError;
module.exports.BadRequestError            = BadRequestError;
module.exports.InternalServerError        = InternalServerError;
module.exports.NoPermissionError          = NoPermissionError;
module.exports.UnauthorizedError          = UnauthorizedError;
module.exports.ValidationError            = ValidationError;
module.exports.RequestEntityTooLargeError = RequestEntityTooLargeError;
module.exports.UnsupportedMediaTypeError  = UnsupportedMediaTypeError;
module.exports.EmailError                 = EmailError;
module.exports.DataImportError            = DataImportError;
