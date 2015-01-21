var Promise = require('bluebird'),
    fs = require('fs'),
    semver = require('semver'),
    packageInfo = require('../../package.json'),
    errors = require('./errors'),
    config = require('./config');

function GhostServer(rootApp) {
    this.rootApp = rootApp;
    this.httpServer = null;
    this.connections = {};
    this.connectionId = 0;
    this.upgradeWarning = setTimeout(this.logUpgradeWarning.bind(this), 5000);

    // Expose config module for use externally.
    this.config = config;
}

GhostServer.prototype.connection = function (socket) {
    var self = this;

    self.connectionId += 1;
    socket._ghostId = self.connectionId;

    socket.on('close', function () {
        delete self.connections[this._ghostId];
    });

    self.connections[socket._ghostId] = socket;
};

// Most browsers keep a persistent connection open to the server
// which prevents the close callback of httpServer from returning
// We need to destroy all connections manually
GhostServer.prototype.closeConnections = function () {
    var self = this;

    Object.keys(self.connections).forEach(function (socketId) {
        var socket = self.connections[socketId];

        if (socket) {
            socket.destroy();
        }
    });
};

GhostServer.prototype.logStartMessages = function () {
    // Tell users if their node version is not supported, and exit
    if (!semver.satisfies(process.versions.node, packageInfo.engines.node)) {
        console.log(
            '\nERROR: Unsupported version of Node'.red,
            '\nGhost needs Node version'.red,
            packageInfo.engines.node.yellow,
            'you are using version'.red,
            process.versions.node.yellow,
            '\nPlease go to http://nodejs.org to get a supported version'.green
        );

        process.exit(0);
    }

    // Startup & Shutdown messages
    if (process.env.NODE_ENV === 'production') {
        console.log(
            'Ghost is running...'.green,
            '\nYour blog is now available on',
            config.url,
            '\nCtrl+C to shut down'.grey
        );
    } else {
        console.log(
            ('Ghost is running in ' + process.env.NODE_ENV + '...').green,
            '\nListening on',
                config.getSocket() || config.server.host + ':' + config.server.port,
            '\nUrl configured as:',
            config.url,
            '\nCtrl+C to shut down'.grey
        );
    }

    function shutdown() {
        console.log('\nGhost has shut down'.red);
        if (process.env.NODE_ENV === 'production') {
            console.log(
                '\nYour blog is now offline'
            );
        } else {
            console.log(
                '\nGhost was running for',
                Math.round(process.uptime()),
                'seconds'
            );
        }
        process.exit(0);
    }
    // ensure that Ghost exits correctly on Ctrl+C and SIGTERM
    process.
        removeAllListeners('SIGINT').on('SIGINT', shutdown).
        removeAllListeners('SIGTERM').on('SIGTERM', shutdown);
};

GhostServer.prototype.logShutdownMessages = function () {
    console.log('Ghost is closing connections'.red);
};

GhostServer.prototype.logUpgradeWarning = function () {
    errors.logWarn(
        'Ghost no longer starts automatically when using it as an npm module.',
        'If you\'re seeing this message, you may need to update your custom code.',
        'Please see the docs at http://tinyurl.com/npm-upgrade for more information.'
    );
};

/**
 * Starts the ghost server listening on the configured port.
 * Alternatively you can pass in your own express instance and let Ghost
 * start lisetning for you.
 * @param  {Object=} externalApp Optional express app instance.
 * @return {Promise}
 */
GhostServer.prototype.start = function (externalApp) {
    var self = this,
        rootApp = externalApp ? externalApp : self.rootApp;

    // ## Start Ghost App
    return new Promise(function (resolve) {
        var socketConfig = config.getSocket();

        if (socketConfig) {
            // Make sure the socket is gone before trying to create another
            try {
                fs.unlinkSync(socketConfig.path);
            } catch (e) {
                // We can ignore this.
            }

            self.httpServer = rootApp.listen(socketConfig.path);

            fs.chmod(socketConfig.path, socketConfig.permissions);
        } else {
            self.httpServer = rootApp.listen(
                config.server.port,
                config.server.host
            );
        }

        self.httpServer.on('error', function (error) {
            if (error.errno === 'EADDRINUSE') {
                errors.logError(
                    '(EADDRINUSE) Cannot start Ghost.',
                    'Port ' + config.server.port + ' is already in use by another program.',
                    'Is another Ghost instance already running?'
                );
            } else {
                errors.logError(
                    '(Code: ' + error.errno + ')',
                    'There was an error starting your server.',
                    'Please use the error code above to search for a solution.'
                );
            }
            process.exit(-1);
        });
        self.httpServer.on('connection', self.connection.bind(self));
        self.httpServer.on('listening', function () {
            self.logStartMessages();
            clearTimeout(self.upgradeWarning);
            resolve(self);
        });
    });
};

// Returns a promise that will be fulfilled when the server stops.
// If the server has not been started, the promise will be fulfilled
// immediately
GhostServer.prototype.stop = function () {
    var self = this;

    return new Promise(function (resolve) {
        if (self.httpServer === null) {
            resolve(self);
        } else {
            self.httpServer.close(function () {
                self.httpServer = null;
                self.logShutdownMessages();
                resolve(self);
            });

            self.closeConnections();
        }
    });
};

// Restarts the ghost application
GhostServer.prototype.restart = function () {
    return this.stop().then(this.start.bind(this));
};

// To be called after `stop`
GhostServer.prototype.hammertime = function () {
    console.log('Can\'t touch this'.green);

    return Promise.resolve(this);
};

module.exports = GhostServer;
