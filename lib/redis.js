'use strict';

const util = require('util');
const redisSearch = require('redisearch');
const async = require.main.require('async');

const db = require.main.require('./src/database');

exports.createIndices = async function () {
	db.postSearch = redisSearch.createSearch('nodebbpostsearch', db.client);
	db.topicSearch = redisSearch.createSearch('nodebbtopicsearch', db.client);
};

function postQuery(query, limit, callback) {
	db.postSearch.query(query, 0, limit - 1, callback);
}

function topicQuery(query, limit, callback) {
	db.topicSearch.query(query, 0, limit - 1, callback);
}

const postQueryAsync = util.promisify(postQuery);
const topicQueryAsync = util.promisify(topicQuery);

exports.changeIndexLanguage = async function () {
	// not supported

};

exports.searchIndex = async function (key, data, ids) {
	const method = key === 'post' ? db.postSearch : db.topicSearch;

	const indexData = ids.map((id, index) => ({ id: id, data: data[index] }));

	await async.eachLimit(indexData, 500, function (indexData, next) {
		method.index(indexData.data, indexData.id, function (err) {
			next(err);
		});
	});
};

exports.search = async function (key, data, limit) {
	const queryMethod = key === 'post' ? postQueryAsync : topicQueryAsync;

	const query = {
		matchWords: data.matchWords,
		query: {
			cid: data.cid,
			uid: data.uid,
			content: data.content,
		},
	};

	return await queryMethod(query, limit);
};

exports.searchRemove = async function (key, ids) {
	if (!key || !ids.length) {
		return;
	}
	var method = key === 'post' ? db.postSearch : db.topicSearch;

	await async.eachLimit(ids, 500, function (id, next) {
		method.remove(id, next);
	});
};
