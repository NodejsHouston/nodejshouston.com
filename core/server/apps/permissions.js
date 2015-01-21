
var fs = require('fs'),
    Promise = require('bluebird'),
    path = require('path'),
    parsePackageJson = require('../require-tree').parsePackageJson;

function AppPermissions(appPath) {
    this.appPath = appPath;
    this.packagePath = path.join(this.appPath, 'package.json');
}

AppPermissions.prototype.read = function () {
    var self = this;

    return this.checkPackageContentsExists().then(function (exists) {
        if (!exists) {
            // If no package.json, return default permissions
            return Promise.resolve(AppPermissions.DefaultPermissions);
        }

        // Read and parse the package.json
        return self.getPackageContents().then(function (parsed) {
            // If no permissions in the package.json then return the default permissions.
            if (!(parsed.ghost && parsed.ghost.permissions)) {
                return Promise.resolve(AppPermissions.DefaultPermissions);
            }

            // TODO: Validation on permissions object?

            return Promise.resolve(parsed.ghost.permissions);
        });
    });
};

AppPermissions.prototype.checkPackageContentsExists = function () {
    var self = this;

    // Mostly just broken out for stubbing in unit tests
    return new Promise(function (resolve) {
        fs.exists(self.packagePath, function (exists) {
            resolve(exists);
        });
    });
};

// Get the contents of the package.json in the appPath root
AppPermissions.prototype.getPackageContents = function () {
    var messages = {
        errors: [],
        warns: []
    };

    return parsePackageJson(this.packagePath, messages)
        .then(function (parsed) {
            if (!parsed) {
                return Promise.reject(new Error(messages.errors[0].message));
            }

            return parsed;
        });
};

// Default permissions for an App.
AppPermissions.DefaultPermissions = {
    posts: ['browse', 'read']
};

module.exports = AppPermissions;
