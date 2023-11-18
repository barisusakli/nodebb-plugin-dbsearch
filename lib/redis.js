'use strict';

const redisSearch = require('redisearch');

const async = require.main.require('async');

const db = require.main.require('./src/database');

exports.createIndices = async function () {
	db.postSearch = redisSearch.createSearch('nodebbpostsearch', db.client);
	db.topicSearch = redisSearch.createSearch('nodebbtopicsearch', db.client);
	db.chatSearch = redisSearch.createSearch('nodebbchatsearch', db.client);
};

exports.changeIndexLanguage = async function () {
	// not supported
};

exports.searchIndex = async function (key, data, ids) {
	const method = key === 'post' ? db.postSearch : db.topicSearch;

	const indexData = ids.map((id, index) => ({ id: id, data: data[index] }));

	await async.eachLimit(indexData, 500, async (indexData) => {
		await method.index(indexData.data, indexData.id);
	});
};

exports.search = async function (key, data, limit) {
	const queryMethod = key === 'post' ? db.postSearch : db.topicSearch;

	const query = {
		matchWords: data.matchWords,
		query: {
			cid: data.cid,
			uid: data.uid,
			content: data.content,
		},
	};

	return await queryMethod.query(query, 0, limit - 1);
};

exports.searchRemove = async function (key, ids) {
	if (!key || !ids.length) {
		return;
	}
	await async.eachLimit(ids, 500, async (ids) => {
		await db[`${key}Search`].remove(ids);
	});
};

exports.chat = {};
exports.chat.index = async (data, ids) => {
	if (!ids.length) {
		return;
	}
	const indexData = ids.map((id, index) => ({
		id: id,
		data: {
			content: String(data[index].content),
			roomId: String(data[index].roomId),
			uid: String(data[index].uid),
		},
	}));

	await async.eachLimit(indexData, 500, async (indexData) => {
		await db.chatSearch.index(indexData.data, indexData.id);
	});
};

exports.chat.search = async (data, limit) => {
	const query = {
		matchWords: data.matchWords,
		query: {
			content: data.content,
		},
	};
	['roomId', 'uid'].forEach((prop) => {
		if (data.hasOwnProperty(prop)) {
			if (Array.isArray(data[prop]) && data[prop].filter(Boolean).length) {
				query.query[prop] = data[prop].filter(Boolean);
			}
		}
	});

	return await db.chatSearch.query(query, 0, limit - 1);
};
