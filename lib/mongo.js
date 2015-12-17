'use strict';

var winston = require.main.require('winston');
var async = require.main.require('async');

module.exports = function(db) {

	async.parallel([
		function(next) {
			db.client.collection('searchtopic').ensureIndex({content: 'text', uid: 1, cid: 1}, {background: true}, next);
		},
		function(next) {
			db.client.collection('searchtopic').ensureIndex({id: 1}, {background: true}, next);
		},
		function(next) {
			db.client.collection('searchpost').ensureIndex({content: 'text', uid: 1, cid: 1}, {background: true}, next);
		},
		function(next) {
			db.client.collection('searchpost').ensureIndex({id: 1}, {background: true}, next);
		}
	], function(err) {
		if (err) {
			winston.error(err);
		}
	});

	db.searchIndex = function(key, data, id, callback) {
		callback = callback || function() {};
		id = parseInt(id, 10);
		if (!id) {
			return callback();
		}
		var setData = {
			id: id
		};
		for(var field in data) {
			if (data.hasOwnProperty(field) && data[field]) {
				setData[field] = data[field].toString();
			}
		}

		db.client.collection('search' + key).update({id: id}, {$set: setData}, {upsert:true, w: 1}, function(err) {
			if (err) {
				winston.error('Error indexing ' + err.message);
			}
			callback(err);
		});
	};

	db.search = function(key, data, limit, callback) {
		var searchQuery = {};

		if (data.content) {
			searchQuery.$text = {$search: data.content};
		}

		if (Array.isArray(data.cid) && data.cid.length) {
			data.cid = data.cid.filter(Boolean);
			if (data.cid.length > 1) {
				searchQuery.cid = {$in: data.cid.map(String)};
			} else if (data.cid[0]) {
				searchQuery.cid = data.cid[0].toString();
			}
		}

		if (Array.isArray(data.uid) && data.uid.length) {
			data.uid = data.uid.filter(Boolean);
			if (data.uid.length > 1) {
				searchQuery.uid = {$in: data.uid.map(String)};
			} else if (data.uid[0]) {
				searchQuery.uid = data.uid[0].toString();
			}
		}

		db.client.collection('search' + key).find(searchQuery, {limit: parseInt(limit, 10), fields:{_id: 0, id: 1}}).toArray(function(err, results) {
			if (err) {
				return callback(err);
			}

			if (!results || !results.length) {
				return callback(null, []);
			}

			var data = results.map(function(item) {
				return item.id;
			});

			callback(null, data);
		});
	};

	db.searchRemove = function(key, id, callback) {
		callback = callback || function() {};
		id = parseInt(id, 10);
		if (!id) {
			return callback();
		}

		db.client.collection('search' + key).remove({id: id}, function(err, res) {
			callback(err);
		});
	};
};
