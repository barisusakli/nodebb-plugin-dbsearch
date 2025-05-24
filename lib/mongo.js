'use strict';

const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');

function generateIndexName(indexSpec) {
	return Object.entries(indexSpec)
		.map(([key, value]) => `${key}_${value}`)
		.join('_');
}

async function safeCreateIndex(collection, indexSpec, options) {
	try {
		await db.client.collection(collection).createIndex(indexSpec, options);
	} catch (err) {
		if (err.code === 85) { // index options conflict, retry by dropping the index
			await safeDropIndex(collection, generateIndexName(indexSpec));
			await safeCreateIndex(collection, indexSpec, options);
			return;
		}
		throw err;
	}
}

async function safeDropIndex(collection, indexName) {
	try {
		await db.client.collection(collection).dropIndex(indexName);
	} catch (err) {
		// Ignore "index not found (27)" error
		if (err.code !== 27) {
			throw err;
		}
	}
};

exports.createIndices = async function (language) {
	const options = { background: true };
	if (language && language !== 'en') {
		options.default_language = language;
	}

	if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
		await safeCreateIndex('searchtopic', { content: 'text', uid: 1, cid: 1 }, options);
		await safeCreateIndex('searchtopic', { ts: 1 }, { background: true });

		await safeCreateIndex('searchpost', { content: 'text', uid: 1, cid: 1 }, options);
		await safeCreateIndex('searchpost', { ts: 1 }, { background: true });

		await safeCreateIndex('searchchat', { content: 'text', roomId: 1, uid: 1 }, options);
	}
};

exports.changeIndexLanguage = async function (language) {
	const indexSpec = { content: 'text', uid: 1, cid: 1 };
	const options = { background: true };
	if (language !== 'en') {
		options.default_language = language;
	}

	await safeDropIndex('searchtopic', 'content_text_uid_1_cid_1');
	await db.client.collection('searchtopic').createIndex(indexSpec, options);

	await safeDropIndex('searchpost', 'content_text_uid_1_cid_1');
	await db.client.collection('searchpost').createIndex(indexSpec, options);

	await safeDropIndex('searchchat', 'content_text_roomId_1_uid_1');
	await db.client.collection('searchchat').createIndex({ content: 'text', roomId: 1, uid: 1 }, options);
};

exports.searchIndex = async function (key, data, ids) {
	if (!ids.length) {
		return;
	}

	const bulk = db.client.collection(`search${key}`).initializeUnorderedBulkOp();
	ids.forEach((id, index) => {
		const setData = {};
		Object.keys(data[index]).forEach((field) => {
			if (data[index].hasOwnProperty(field) && data[index][field]) {
				if (field === 'timestamp') {
					setData.ts = parseInt(data[index][field], 10);
				} else {
					setData[field] = data[index][field].toString();
				}
			}
		});

		bulk.find({ _id: String(id) }).upsert().updateOne({ $set: setData });
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

	if (data.searchData.timeFilter && data.searchData.timeRange) {
		const timeRange = parseInt(data.searchData.timeRange, 10) * 1000;
		if (timeRange) {
			const ts = Date.now() - timeRange;
			searchQuery.ts = data.searchData.timeFilter === 'newer' ?
				{ $gte: ts } :
				{ $lte: ts };
		}
	}

	const aggregate = [{ $match: searchQuery }];
	if (searchQuery.$text) {
		const sortQuery = { score: { $meta: 'textScore' } };
		if (data.searchData.sortBy === 'timestamp' || data.searchData.sortBy === 'topic.timestamp') {
			sortQuery.ts = data.searchData.sortDirection === 'asc' ? 1 : -1;
		}
		aggregate.push({ $sort: sortQuery });
	} else {
		aggregate.push({ $sort: { ts: data.searchData.sortDirection === 'asc' ? 1 : -1 } });
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

	await db.client.collection(`search${key}`).deleteMany({ _id: { $in: ids.map(String) } });
};

exports.chat = {};
exports.chat.index = async (data, ids) => {
	if (!ids.length) {
		return;
	}

	const bulk = db.client.collection(`searchchat`).initializeUnorderedBulkOp();
	ids.forEach((id, index) => {
		const d = data[index];
		if (d && d.content && d.uid && d.roomId) {
			bulk.find({ _id: String(id) }).upsert().updateOne({
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

