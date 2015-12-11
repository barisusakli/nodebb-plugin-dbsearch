'use strict';

var redisSearch = require('redisearch');

module.exports = function(db) {

	db.postSearch = redisSearch.createSearch('nodebbpostsearch', db.client);
	db.topicSearch = redisSearch.createSearch('nodebbtopicsearch', db.client);

	db.searchIndex = function(key, data, id, callback) {
		var method = key === 'post' ? db.postSearch : db.topicSearch;

		method.index(data, id, function(err, res) {
			callback(err);
		});
	};

	db.search = function(key, data, limit, callback) {
		var method = key === 'post' ? db.postSearch : db.topicSearch;

		method.query(data, 0, limit - 1, callback);
	};

	db.searchRemove = function(key, id, callback) {
		callback = callback || function() {};
		if (!id) {
			return callback();
		}
		var method = key === 'post' ? db.postSearch : db.topicSearch;

		method.remove(id, function(err, res) {
			callback(err);
		});
	};
};

