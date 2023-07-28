'use strict';

const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');

exports.createIndices = async function (language) {
	const options = { background: true };
	if (language && language !== 'en') {
		options.default_language = language;
	}

	if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
		await db.client.collection('searchtopic').createIndex({ content: 'text', uid: 1, cid: 1 }, options);
		await db.client.collection('searchpost').createIndex({ content: 'text', uid: 1, cid: 1 }, options);
		await db.client.collection('searchchat').createIndex({ content: 'text', roomId: 1, uid: 1 }, options);
	}
};

exports.changeIndexLanguage = async function (language) {
	const indexSpec = { content: 'text', uid: 1, cid: 1 };
	const options = { background: true };
	if (language !== 'en') {
		options.default_language = language;
	}
	await db.client.collection('searchtopic').dropIndex('content_text_uid_1_cid_1');
	await db.client.collection('searchtopic').createIndex(indexSpec, options);
	await db.client.collection('searchpost').dropIndex('content_text_uid_1_cid_1');
	await db.client.collection('searchpost').createIndex(indexSpec, options);
	await db.client.collection('searchchat').dropIndex('content_text_roomId_1_uid_1');
	await db.client.collection('searchchat').createIndex({ content: 'text', roomId: 1, uid: 1 }, options);
};

exports.searchIndex = async function (key, data, ids) {
	if (!ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));

	const bulk = db.client.collection(`search${key}`).initializeUnorderedBulkOp();
	ids.forEach((id, index) => {
		const setData = {};
		Object.keys(data[index]).forEach((field) => {
			if (data[index].hasOwnProperty(field) && data[index][field]) {
				setData[field] = data[index][field].toString();
			}
		});

		bulk.find({ _id: id }).upsert().updateOne({ $set: setData });
	});

	await bulk.execute();
};

exports.search = async function (key, data, limit) {
	const searchQuery = {};
	if (data.content) {
		searchQuery.$text = buildTextQuery(data.content, data.matchWords);
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

	const aggregate = [{ $match: searchQuery }];
	if (searchQuery.$text) {
		const sortQuery = { score: { $meta: 'textScore' } };
		if (data.searchData.sortBy === 'timestamp' || data.searchData.sortBy === 'topic.timestamp') {
			sortQuery._id = data.searchData.sortDirection === 'asc' ? 1 : -1;
		}
		aggregate.push({ $sort: sortQuery });
	} else {
		aggregate.push({ $sort: { _id: data.searchData.sortDirection === 'asc' ? 1 : -1 } });
	}
	aggregate.push({ $limit: parseInt(limit, 10) });
	aggregate.push({ $project: { _id: 1 } });

	const results = await db.client.collection(`search${key}`).aggregate(aggregate).toArray();
	if (!results || !results.length) {
		return [];
	}
	return results.map(item => item._id);
};

exports.searchRemove = async function (key, ids) {
	if (!key || !ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));

	await db.client.collection(`search${key}`).deleteMany({ _id: { $in: ids } });
};

exports.chat = {};
exports.chat.index = async (data, ids) => {
	if (!ids.length) {
		return;
	}

	ids = ids.map(id => parseInt(id, 10));

	const bulk = db.client.collection(`searchchat`).initializeUnorderedBulkOp();
	ids.forEach((id, index) => {
		const d = data[index];
		if (d && d.content && d.uid && d.roomId) {
			bulk.find({ _id: id }).upsert().updateOne({
				$set: {
					content: String(d.content),
					roomId: String(d.roomId),
					uid: String(d.uid),
				},
			});
		}
	});

	await bulk.execute();
};

exports.chat.search = async (data, limit) => {
	const searchQuery = {};
	if (!data.content) {
		return [];
	}
	searchQuery.$text = buildTextQuery(data.content, data.matchWords);

	if (Array.isArray(data.roomId) && data.roomId.filter(Boolean).length) {
		if (data.roomId.length > 1) {
			searchQuery.roomId = { $in: data.roomId.filter(Boolean).map(String) };
		} else {
			searchQuery.roomId = String(data.roomId[0]);
		}
	}

	if (Array.isArray(data.uid) && data.uid.filter(Boolean).length) {
		if (data.uid.length > 1) {
			searchQuery.uid = { $in: data.uid.filter(Boolean).map(String) };
		} else {
			searchQuery.uid = String(data.uid[0]);
		}
	}

	const collection = db.client.collection(`searchchat`);
	const results = await collection.aggregate([
		{ $match: searchQuery },
		{ $sort: { score: { $meta: 'textScore' } } },
		{ $limit: parseInt(limit, 10) },
		{ $project: { _id: 1 } },
	]).toArray();
	if (!results || !results.length) {
		return [];
	}
	return results.map(item => item._id);
};

function buildTextQuery(content, matchWords) {
	let words = content.split(' ');
	const allQuoted = content.startsWith('"') && content.endsWith('"');
	if (matchWords === 'all' && !allQuoted) {
		words = words.map((word) => {
			if (!word.startsWith('"') && !word.endsWith('"')) {
				return `"${word}"`;
			}
			return word;
		});
	}

	return { $search: words.join(' ') };
}

