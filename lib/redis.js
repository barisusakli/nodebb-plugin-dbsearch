'use strict';

var redisSearch = require('redisearch');
var async = require.main.require('async');

var nbbRequire = require('./nbbRequire');
var db = nbbRequire('src/database');

exports.createIndices = function (callback) {
	callback = callback || function () {};
	db.postSearch = redisSearch.createSearch('nodebbpostsearch', db.client);
	db.topicSearch = redisSearch.createSearch('nodebbtopicsearch', db.client);
	callback();
};

exports.searchIndex = function(key, data, ids, callback) {
	var method = key === 'post' ? db.postSearch : db.topicSearch;

	var indexData = ids.map(function(id, index) {
		return {
			id: id,
			data: data[index]
		};
	});

	async.eachLimit(indexData, 500, function(indexData, next) {
		method.index(indexData.data, indexData.id, function(err) {
			next(err);
		});
	}, function(err) {
		callback(err);
	});
};

exports.search = function(key, data, limit, callback) {
	var method = key === 'post' ? db.postSearch : db.topicSearch;

	method.query(data, 0, limit - 1, callback);
};

exports.searchRemove = function(key, ids, callback) {
	callback = callback || function() {};
	if (!ids.length) {
		return callback();
	}
	var method = key === 'post' ? db.postSearch : db.topicSearch;

	async.eachLimit(ids, 500, function(id, next) {
		method.remove(id, next);
	}, function(err) {
		callback(err);
	});
};
