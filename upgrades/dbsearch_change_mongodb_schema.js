'use strict';


var async = require.main.require('async');
var winston = require.main.require('winston');
var db = module.parent.require('./database');

module.exports = {
	name: 'Changing dbsearch mongodb search schema to use _id',
	timestamp: Date.UTC(2018, 10, 26),
	method: function (callback) {
		const nconf = require.main.require('nconf');
		var isMongo = nconf.get('database') === 'mongo';
		var progress = this.progress;
		if (!isMongo) {
			return callback();
		}

		const plugin = require('../lib/dbsearch');
		var client = db.client;
		async.series([
			function (next) {
				client.collection('searchtopic').removeMany({}, next);
			},
			function (next) {
				client.collection('searchpost').removeMany({}, next);
			},
			function (next) {
				client.collection('searchtopic').dropIndex({id: 1}, function (err) {
					if (err) {
						winston.error(err);
					}
					next();
				});
			},
			function (next) {
				client.collection('searchpost').dropIndex({id: 1}, function (err) {
					if (err) {
						winston.error(err);
					}
					next();
				});
			},
			function (next) {
				plugin.reindex(next);
			},
		], callback);
	},
};