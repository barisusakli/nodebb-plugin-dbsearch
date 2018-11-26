'use strict';

var winston = require.main.require('winston');
var async = require.main.require('async');
var nconf = require.main.require('nconf');

var db = require.main.require('./src/database');

exports.createIndices = function (language, callback) {
	callback = callback || function () {};
	var options = {background: true};
	if (language && language !== 'en') {
		options.default_language = language;
	}

	if (nconf.get('isPrimary') === 'true' && !nconf.get('jobsDisabled')) {
		async.series([
			function(next) {
				db.client.collection('searchtopic').createIndex({content: 'text', uid: 1, cid: 1}, options, next);
			},
			function(next) {
				db.client.collection('searchpost').createIndex({content: 'text', uid: 1, cid: 1}, options, next);
			},
		], function(err) {
			if (err) {
				winston.error(err);
			}
			callback(err);
		});
	}
};

exports.changeIndexLanguage = function (language, callback) {
	var indexSpec = { content: 'text', uid: 1, cid: 1 };
	var options = { background: true};
	if (language !== 'en') {
		options.default_language = language;
	}
	async.series([
		function(next) {
			db.client.collection('searchtopic').dropIndex('content_text_uid_1_cid_1', next);
		},
		function(next) {
			db.client.collection('searchtopic').createIndex(indexSpec, options, next);
		},
		function(next) {
			db.client.collection('searchpost').dropIndex('content_text_uid_1_cid_1', next);
		},
		function(next) {
			db.client.collection('searchpost').createIndex(indexSpec, options, next);
		},
	], function(err) {
		if (err) {
			winston.error(err);
		}
		callback(err);
	});
}

exports.searchIndex = function(key, data, ids, callback) {
	callback = callback || function() {};

	if (!ids.length) {
		return setImmediate(callback);
	}

	ids = ids.map(id => parseInt(id, 10));

	var bulk = db.client.collection('search' + key).initializeUnorderedBulkOp();
	ids.forEach(function(id, index) {
		var setData = {};

		for(var field in data[index]) {
			if (data[index].hasOwnProperty(field) && data[index][field]) {
				setData[field] = data[index][field].toString();
			}
		}

		bulk.find({ _id: id }).upsert().updateOne({ $set: setData });
	});

	bulk.execute(function(err) {
		if (err) {
	 		winston.error('Error indexing ' + err.message);
	 	}
		callback(err);
	});
};

exports.search = function(key, data, limit, callback) {
	var searchQuery = {};
	if (data.content) {
		var words = data.content.split(' ');
		var allQuoted = data.content.startsWith('"') && data.content.endsWith('"');
		if (data.matchWords === 'all' && !allQuoted) {
			words = words.map(function (word) {
				if (!word.startsWith('"') && !word.endsWith('"')) {
					return '"' + word + '"';
				} else {
					return word;
				}
			})
		}

		searchQuery.$text = { $search: words.join(' ') };
	}

	if (Array.isArray(data.cid) && data.cid.length) {
		if (data.cid.length > 1) {
			searchQuery.cid = { $in: data.cid.map(String) };
		} else {
			searchQuery.cid = String(data.cid[0]);
		}
	}

	if (Array.isArray(data.uid) && data.uid.length) {
		if (data.uid.length > 1) {
			searchQuery.uid = { $in: data.uid.map(String) };
		} else {
			searchQuery.uid = String(data.uid[0]);
		}
	}

	var aggregate = [{ $match: searchQuery }];
	if (searchQuery.$text) {
		aggregate.push({ $sort: { score: { $meta: 'textScore' } } });
	} else {
		aggregate.push({ $sort: { _id: -1 } });
	}
	aggregate.push({ $limit: parseInt(limit, 10) });
	aggregate.push({ $project: { _id: 1 } });

	db.client.collection('search' + key).aggregate(aggregate).toArray(function(err, results) {
		if (err) {
			return callback(err);
		}

		if (!results || !results.length) {
			return callback(null, []);
		}

		const data = results.map(item => item._id);

		callback(null, data);
	});
};

exports.searchRemove = function(key, ids, callback) {
	callback = callback || function() {};

	if (!ids.length) {
		return setImmediate(callback);
	}

	ids = ids.map(id => parseInt(id, 10));

	db.client.collection('search' + key).remove({ _id: { $in: ids } }, function(err) {
		callback(err);
	});
};

