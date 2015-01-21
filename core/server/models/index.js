var _       = require('lodash'),
    Promise = require('bluebird'),
    requireTree   = require('../require-tree'),
    models;

models = {
    excludeFiles: ['_messages', 'basetoken.js', 'base.js', 'index.js'],

    // ### init
    // Scan all files in this directory and then require each one and cache
    // the objects exported onto this `models` object so that every other
    // module can safely access models without fear of introducing circular
    // dependency issues.
    // @returns {Promise}
    init: function () {
        var self = this;

        // One off inclusion of Base file.
        self.Base = require('./base');

        // Require all files in this directory
        return requireTree.readAll(__dirname, {followSymlinks: false}).then(function (modelFiles) {
            // For each found file, excluding those we don't want,
            // we will require it and cache it here.
            _.each(modelFiles, function (path, fileName) {
                // Return early if this fileName is one of the ones we want
                // to exclude.
                if (_.contains(self.excludeFiles, fileName)) {
                    return;
                }

                // Require the file.
                var file = require(path);

                // Cache its `export` object onto this object.
                _.extend(self, file);
            });

            return;
        });
    },
    // ### deleteAllContent
    // Delete all content from the database (posts, tags, tags_posts)
    deleteAllContent: function () {
        var self = this;

        return self.Post.findAll().then(function (posts) {
            return Promise.all(_.map(posts.toJSON(), function (post) {
                return self.Post.destroy({id: post.id});
            }));
        }).then(function () {
            return self.Tag.findAll().then(function (tags) {
                return Promise.all(_.map(tags.toJSON(), function (tag) {
                    return self.Tag.destroy({id: tag.id});
                }));
            });
        });
    }
};

module.exports = models;
