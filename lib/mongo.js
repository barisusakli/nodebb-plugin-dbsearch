'use strict';

const nconf = nodebb.require('nconf');
const crypto = require('node:crypto');

const db = nodebb.require('./src/database');
const cacheCreate = nodebb.require('./src/cache/lru');
const cacheTTL = 1000 * 30;
const searchCache = cacheCreate({
	name: 'dbsearch:mongodb',
	max: 500,
	ttl: cacheTTL,
});

const SEARCH_INDEXES = [
	{ collection: 'searchtopic', name: 'dbsearch-v1', fields: ['uid', 'cid', 'ts'], legacyTextIndexes: ['content_text_uid_1_cid_1', 'ts_1'] },
	{ collection: 'searchpost', name: 'dbsearch-v1', fields: ['uid', 'cid', 'ts'], legacyTextIndexes: ['content_text_uid_1_cid_1', 'ts_1'] },
	{ collection: 'searchchat', name: 'dbsearch-v1', fields: ['uid', 'roomId'], legacyTextIndexes: ['content_text_roomId_1_uid_1'] },
];

const SEARCH_ANALYZERS = {
	da: 'danish',
	nl: 'dutch',
	en: 'english',
	fi: 'finnish',
	fr: 'french',
	de: 'german',
	hu: 'hungarian',
	it: 'italian',
	nb: 'norwegian',
	pt: 'portuguese',
	ro: 'romanian',
	ru: 'russian',
	es: 'spanish',
	sv: 'swedish',
	tr: 'turkish',
};

const readySearchIndexes = new Set();

const VALID_READ_PREFERENCES = [
	'primary',
	'primaryPreferred',
	'secondary',
	'secondaryPreferred',
	'nearest',
];

let readPreference = 'primary';

exports.VALID_READ_PREFERENCES = VALID_READ_PREFERENCES;

exports.setReadPreference = function (pref) {
	if (VALID_READ_PREFERENCES.includes(pref)) {
		readPreference = pref;
	} else {
		readPreference = 'primary';
	}
};

function readOptions() {
	return readPreference === 'primary' ? {} : { readPreference };
}

function getCacheKey(collectionName, aggregate) {
	const hash = crypto
		.createHash('sha256')
		.update(JSON.stringify([collectionName, aggregate]))
		.digest('hex');

	return `search:${hash}`;
}

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
		if (![26, 27].includes(err.code)) {
			throw err;
		}
	}
};

async function safeDropSearchIndex(collection, indexName) {
	try {
		await db.client.collection(collection).dropSearchIndex(indexName);
	} catch (err) {
		if (![26, 27, 59].includes(err.code) && err.codeName !== 'SearchNotEnabled') {
			throw err;
		}
	}
}

async function dropMongoSearchIndexes() {
	await Promise.all(SEARCH_INDEXES.map(index => safeDropSearchIndex(index.collection, index.name)));
}

async function dropLegacyTextIndexes(index) {
	await Promise.all(
		index.legacyTextIndexes.map(indexName => safeDropIndex(index.collection, indexName))
	);
}

function isMongoSearchEnabled() {
	const mongoConfig = nconf.get('mongo') || {};
	return mongoConfig.useMongoSearch === true || mongoConfig.useMongoSearch === 'true';
}

function getSearchIndexDefinition(language, fields) {
	const analyzer = SEARCH_ANALYZERS[language];
	if (!analyzer) {
		throw new Error(`Unsupported MongoDB Search language: ${language}`);
	}

	const mappedFields = {
		content: { type: 'string', analyzer: `lucene.${analyzer}` },
		uid: { type: 'token' },
	};
	fields.forEach((field) => {
		mappedFields[field] = field === 'ts' ? { type: 'number' } : { type: 'token' };
	});

	return { mappings: { dynamic: false, fields: mappedFields } };
}

async function assertMongoSearchReplicaSet() {
	let hello;
	try {
		hello = await db.client.admin().command({ hello: 1 });
	} catch (err) {
		throw new Error(`MongoDB Search requires a configured replica set and mongot. Could not verify MongoDB topology: ${err.message}`, { cause: err });
	}
	if (!hello.setName) {
		throw new Error('mongo.useMongoSearch requires MongoDB to run as a replica set with mongot configured.');
	}
}

async function ensureMongoSearchIndexes(language, updateExisting = false) {
	await assertMongoSearchReplicaSet();

	await Promise.all(SEARCH_INDEXES.map(async (index) => {
		const collection = db.client.collection(index.collection);
		const definition = getSearchIndexDefinition(language || 'en', index.fields);
		try {
			try {
				await db.client.createCollection(index.collection);
			} catch (err) {
				if (err.code !== 48) {
					throw err;
				}
			}

			const indexes = await collection.listSearchIndexes(index.name).toArray();
			if (!indexes.length) {
				await collection.createSearchIndex({ name: index.name, definition });
			} else if (updateExisting) {
				await collection.updateSearchIndex(index.name, definition);
			} else if (indexes[0].status === 'READY' && indexes[0].queryable === true) {
				await dropLegacyTextIndexes(index);
			}
			readySearchIndexes.delete(index.collection);
		} catch (err) {
			throw new Error(`MongoDB Search setup failed for ${index.collection}. Ensure mongot is running and the database user can manage Search indexes: ${err.message}`, { cause: err });
		}
	}));
}

async function ensureMongoSearchIndexReady(collectionName) {
	if (readySearchIndexes.has(collectionName)) {
		return;
	}

	const index = SEARCH_INDEXES.find(item => item.collection === collectionName);
	if (!index) {
		throw new Error(`No MongoDB Search index is configured for ${collectionName}.`);
	}

	let indexes;
	try {
		indexes = await db.client.collection(collectionName).listSearchIndexes(index.name).toArray();
	} catch (err) {
		throw new Error(`MongoDB Search is enabled, but readiness for index ${index.name} on ${collectionName} could not be checked: ${err.message}`, { cause: err });
	}

	const searchIndex = indexes.find(item => item.name === index.name);
	if (!searchIndex || searchIndex.status !== 'READY' || searchIndex.queryable !== true) {
		const status = searchIndex ? searchIndex.status : 'missing';
		throw new Error(`MongoDB Search index ${index.name} on ${collectionName} is not queryable (status: ${status}). Check mongot and wait for index construction to finish.`);
	}
	await dropLegacyTextIndexes(index);
	readySearchIndexes.add(collectionName);
}

function buildMongoSearchStage(indexName, content, matchWords, filters, sort) {
	const compound = {};
	if (content) {
		const allQuoted = content.startsWith('"') && content.endsWith('"');
		compound.must = allQuoted ? [{
			phrase: { query: content.slice(1, -1), path: 'content' },
		}] : [{
			text: {
				query: content,
				path: 'content',
				...(matchWords === 'all' ? { matchCriteria: 'all' } : {}),
			},
		}];
	}
	if (filters.length) {
		compound.filter = filters;
	} else if (!content) {
		compound.filter = [{ exists: { path: 'content' } }];
	}

	const search = { index: indexName, compound };
	if (sort) {
		search.sort = sort;
	}
	console.log(JSON.stringify({ searchStage: { $search: search } }, null, 2));
	return { $search: search };
}

function buildMongoSearchAggregate(key, data, limit) {
	const collectionName = `search${key}`;
	const index = SEARCH_INDEXES.find(item => item.collection === collectionName);
	if (!index) {
		throw new Error(`No MongoDB Search index is configured for ${collectionName}.`);
	}

	const filters = [];
	if (Array.isArray(data.cid) && data.cid.length) {
		filters.push({ in: { path: 'cid', value: data.cid.map(String) } });
	}
	if (Array.isArray(data.uid) && data.uid.length) {
		filters.push({ in: { path: 'uid', value: data.uid.map(String) } });
	}
	const searchData = data.searchData || {};
	if (searchData.timeFilter && searchData.timeRange) {
		const timeRange = parseInt(searchData.timeRange, 10) * 1000;
		if (timeRange) {
			const now = Math.floor(Date.now() / cacheTTL) * cacheTTL;
			const range = { path: 'ts' };
			range[searchData.timeFilter === 'newer' ? 'gte' : 'lte'] = now - timeRange;
			filters.push({ range });
		}
	}

	const sort = searchData.sortBy === 'timestamp' || searchData.sortBy === 'topic.timestamp' ?
		{ ts: searchData.sortDirection === 'asc' ? 1 : -1 } : null;

	const aggregate = [
		buildMongoSearchStage(index.name, data.content, data.matchWords, filters, sort),
	];
	aggregate.push({ $limit: parseInt(limit, 10) });
	aggregate.push({ $project: { _id: 1 } });
	return { collectionName, aggregate };
}

async function searchWithMongoSearch(key, data, limit) {
	const { collectionName, aggregate } = buildMongoSearchAggregate(key, data, limit);
	await ensureMongoSearchIndexReady(collectionName);
	const cacheKey = getCacheKey(collectionName, aggregate);
	return searchCache.get(cacheKey, async () => {
		const results = await db.client.collection(collectionName).aggregate(aggregate, readOptions()).toArray();
		return results.map(item => item._id);
	});
}

async function searchChatWithMongoSearch(data, limit) {
	const filters = [];
	const roomIds = Array.isArray(data.roomId) ? data.roomId.filter(Boolean) : [];
	if (roomIds.length) {
		filters.push({ in: { path: 'roomId', value: roomIds.map(String) } });
	}
	const uids = Array.isArray(data.uid) ? data.uid.filter(Boolean) : [];
	if (uids.length) {
		filters.push({ in: { path: 'uid', value: uids.map(String) } });
	}

	await ensureMongoSearchIndexReady('searchchat');
	const results = await db.client.collection('searchchat').aggregate([
		buildMongoSearchStage('dbsearch-v1', data.content, data.matchWords, filters),
		{ $limit: parseInt(limit, 10) },
		{ $project: { _id: 1 } },
	], readOptions()).toArray();
	return results.map(item => item._id);
}

exports.createIndices = async function (language) {
	if (isMongoSearchEnabled()) {
		if (nconf.get('runJobs')) {
			await ensureMongoSearchIndexes(language);
		} else {
			await assertMongoSearchReplicaSet();
		}
		return;
	}
	if (nconf.get('runJobs')) {
		await dropMongoSearchIndexes();
	}

	const options = { background: true };
	if (language && language !== 'en') {
		options.default_language = language;
	}

	if (nconf.get('runJobs')) {
		await safeCreateIndex('searchtopic', { content: 'text', uid: 1, cid: 1 }, options);
		await safeCreateIndex('searchtopic', { ts: 1 }, { background: true });

		await safeCreateIndex('searchpost', { content: 'text', uid: 1, cid: 1 }, options);
		await safeCreateIndex('searchpost', { ts: 1 }, { background: true });

		await safeCreateIndex('searchchat', { content: 'text', roomId: 1, uid: 1 }, options);
	}
};

exports.changeIndexLanguage = async function (language) {
	if (isMongoSearchEnabled()) {
		await ensureMongoSearchIndexes(language, true);
		return;
	}
	await dropMongoSearchIndexes();

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
	if (isMongoSearchEnabled()) {
		return searchWithMongoSearch(key, data, limit);
	}

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
			const now = Math.floor(Date.now() / cacheTTL) * cacheTTL;
			const ts = now - timeRange;
			searchQuery.ts = data.searchData.timeFilter === 'newer' ?
				{ $gte: ts } :
				{ $lte: ts };
		}
	}

	const aggregate = [{ $match: searchQuery }];
	if (searchQuery.$text && data.searchData.sortBy !== 'timestamp' && data.searchData.sortBy !== 'topic.timestamp') {
		aggregate.push({ $sort: { score: { $meta: 'textScore' } } });
	} else {
		aggregate.push({ $sort: { ts: data.searchData.sortDirection === 'asc' ? 1 : -1 } });
	}
	aggregate.push({ $limit: parseInt(limit, 10) });
	aggregate.push({ $project: { _id: 1 } });

	const collectionName = `search${key}`;
	const cacheKey = getCacheKey(collectionName, aggregate);
	const ids = await searchCache.get(cacheKey, async () => {
		const results = await db.client
			.collection(collectionName)
			.aggregate(aggregate, readOptions())
			.toArray();
		return results.map(item => item._id);
	});

	return ids;
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
	if (isMongoSearchEnabled()) {
		return searchChatWithMongoSearch(data, limit);
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
	], readOptions()).toArray();
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

exports.getIndexedTopicCount = async () => {
	return await db.client.collection('searchtopic').estimatedDocumentCount(readOptions());
};

exports.getIndexedPostCount = async () => {
	return await db.client.collection('searchpost').estimatedDocumentCount(readOptions());
};

exports.getIndexedChatMessageCount = async () => {
	return await db.client.collection('searchchat').estimatedDocumentCount(readOptions());
};
