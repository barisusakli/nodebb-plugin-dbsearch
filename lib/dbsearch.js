'use strict';

const _ = require('lodash');

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');
const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const messaging = require.main.require('./src/messaging');
const utils = require.main.require('./src/utils');
const socketAdmin = require.main.require('./src/socket.io/admin');
const batch = require.main.require('./src/batch');
const plugins = require.main.require('./src/plugins');
const categories = require.main.require('./src/categories');
const pubsub = require.main.require('./src/pubsub');

const searchModule = require(`./${nconf.get('database')}`);

db.searchIndex = searchModule.searchIndex;
db.search = searchModule.search;
db.searchRemove = searchModule.searchRemove;

const languageLookup = {
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

const defaultPostLimit = 500;
const defaultTopicLimit = 500;

let pluginConfig = {
	postLimit: defaultPostLimit,
	topicLimit: defaultTopicLimit,
	excludeCategories: [],
};

const batchSize = 500;

const search = module.exports;

function convertLanguageName(name) {
	if (nconf.get('database') === 'postgres') {
		return languageLookup[name] || languageLookup.en;
	}
	return name;
}

search.init = async function (params) {
	const { router } = params;
	const routeHelpers = require.main.require('./src/routes/helpers');
	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/dbsearch', renderAdmin);

	router.post('/api/admin/plugins/dbsearch/save', params.middleware.applyCSRF, save);

	pluginConfig = await getPluginData();
	await searchModule.createIndices(convertLanguageName(pluginConfig ? pluginConfig.indexLanguage || 'en' : 'en'));

	pubsub.on('nodebb-plugin-dbsearch:settings:save', (data) => {
		Object.assign(pluginConfig, data);
	});
};

search.actionPostSave = async function (data) {
	const isDeleted = await topics.getTopicField(data.post.tid, 'deleted');
	if (!isDeleted) {
		await postsSave([data.post]);
	}
};

search.actionPostRestore = function (data) {
	search.actionPostSave(data);
};

search.actionPostEdit = function (data) {
	search.actionPostSave(data);
};

search.actionPostDelete = function (data) {
	searchRemove('post', [data.post.pid]);
};

search.actionPostsPurge = function (data) {
	searchRemove('post', data.posts.map(p => p && p.pid));
};

search.actionPostMove = async function (data) {
	const topicData = await topics.getTopicFields(data.post.tid, ['cid', 'deleted']);
	reIndexPids([data.post.pid], topicData);
};

search.actionPostChangeOwner = async function (hookData) {
	const tids = _.uniq(hookData.posts.map(p => p.tid));
	const topicData = await topics.getTopicsFields(tids, ['deleted']);
	const tidToTopic = _.zipObject(tids, topicData);
	const posts = hookData.posts.filter(p => tidToTopic[p.tid] && !tidToTopic[p.tid].deleted);
	posts.forEach((p) => {
		p.uid = hookData.toUid;
	});
	await postsSave(posts);
};

search.actionTopicSave = function (data) {
	topicsSave([data.topic]);
};

search.actionTopicRestore = function (data) {
	reIndexTids([data.topic.tid]);
};

search.actionTopicEdit = function (data) {
	search.actionTopicSave(data);
};

search.actionTopicDelete = async function (data) {
	if (!data || !data.topic) {
		return;
	}
	const { tid } = data.topic;
	await Promise.all([
		searchRemove('topic', [tid]),
		searchRemove('post', [data.topic.mainPid]),
		batch.processSortedSet(`tid:${tid}:posts`, async (pids) => {
			await searchRemove('post', pids);
		}, {
			batch: batchSize,
		}),
	]);
};

search.actionTopicPurge = function (data) {
	search.actionTopicDelete(data);
};

search.actionTopicMove = function (data) {
	reIndexTids([data.tid]);
};

search.actionTopicChangeOwner = function (hookData) {
	hookData.topics.forEach((t) => {
		t.uid = hookData.toUid;
	});
	topicsSave(hookData.topics);
};

search.actionMessagingSave = async function (hookData) {
	await messagesSave([hookData.message]);
};

search.actionMessagingDelete = async function (hookData) {
	await searchRemove('chat', [hookData.message.mid]);
};

search.actionMessagingRestore = async function (hookData) {
	await messagesSave([hookData.message]);
};

search.actionMessagingEdit = async function (hookData) {
	await messagesSave([hookData.message]);
};

search.filterSearchQuery = async function (data) {
	if (!data || !data.index) {
		return data;
	}
	let limit = data.index === 'post' ? pluginConfig.postLimit : pluginConfig.topicLimit;
	if (data.limit) {
		limit = data.limit;
	}
	const query = {};
	if (data.hasOwnProperty('cid')) {
		query.cid = data.cid;
	}
	if (data.hasOwnProperty('uid')) {
		query.uid = data.uid;
	}
	if (data.hasOwnProperty('content')) {
		query.content = data.content;
	}
	if (!Object.keys(query).length) {
		return [];
	}
	if (data.hasOwnProperty('matchWords')) {
		query.matchWords = data.matchWords;
	}
	query.searchData = data.searchData || {};
	data.ids = data.ids.concat(await db.search(data.index, query, limit));
	return data;
};

search.filterSearchTopic = async function (hookData) {
	if (!hookData.term || !hookData.tid) {
		return hookData;
	}
	const cid = await topics.getTopicField(hookData.tid, 'cid');
	const result = await search.filterSearchQuery({
		index: 'post',
		cid: [cid],
		content: hookData.term,
		ids: [],
	});
	const postData = await posts.getPostsFields(result.ids, ['pid', 'tid']);
	hookData.ids = hookData.ids.concat(postData.filter(p => p && p.tid === parseInt(hookData.tid, 10))
		.map(p => p.pid));
	return hookData;
};

search.filterMessagingSearchMessages = async function (data) {
	if (!data || !data.content) {
		return data;
	}
	const limit = 100;
	const query = {};
	if (data.hasOwnProperty('roomId') && data.roomId) {
		query.roomId = data.roomId;
	}
	if (data.hasOwnProperty('uid') && data.uid) {
		query.uid = data.uid;
	}
	if (data.hasOwnProperty('content') && data.content) {
		query.content = data.content;
	}
	if (!Object.keys(query).length) {
		return [];
	}
	if (data.hasOwnProperty('matchWords')) {
		query.matchWords = data.matchWords;
	}

	data.ids = data.ids.concat(await searchModule.chat.search(query, limit));
	return data;
};

search.reindex = async function () {
	await db.setObject('nodebb-plugin-dbsearch', {
		topicsIndexed: 0,
		postsIndexed: 0,
		messagesIndexed: 0,
		working: 1,
	});
	await Promise.all([
		reIndexTopics(),
		reIndexPosts(),
		reIndexMessages(),
	]);
	await db.setObject('nodebb-plugin-dbsearch', {
		working: 0,
	});
};

async function reIndexTopics() {
	await batch.processSortedSet('topics:tid', async (tids) => {
		const topicData = await topics.getTopicsFields(tids, ['tid', 'title', 'uid', 'cid', 'deleted']);
		await topicsSave(topicData);
	}, {
		batch: batchSize,
	});
}

async function topicsSave(topics) {
	topics = topics.filter(
		t => t && utils.isNumber(t.tid) && parseInt(t.deleted, 10) !== 1 &&
		!pluginConfig.excludeCategories.includes(String(t.cid))
	);

	let data = topics.map((topicData) => {
		const indexData = {};
		if (topicData.title) {
			indexData.content = topicData.title;
		}
		if (topicData.cid) {
			indexData.cid = topicData.cid;
		}
		if (topicData.uid) {
			indexData.uid = topicData.uid;
		}
		if (!Object.keys(indexData).length) {
			return null;
		}
		return indexData;
	});

	const tids = topics.filter((t, index) => !!data[index]).map(t => t.tid);
	data = data.filter(Boolean);
	if (!data.length) {
		return;
	}

	const result = await plugins.hooks.fire('filter:search.indexTopics', { data: data, tids: tids, topics: topics });
	await db.searchIndex('topic', result.data, result.tids);
	await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'topicsIndexed', result.tids.length);
}

async function reIndexPosts() {
	await batch.processSortedSet('posts:pid', async (pids) => {
		let postData = await posts.getPostsFields(pids, ['pid', 'content', 'uid', 'tid', 'deleted']);
		postData = postData.filter(p => p && p.deleted !== 1);
		const tids = _.uniq(postData.map(p => p.tid));
		const topicData = await topics.getTopicsFields(tids, ['deleted', 'cid']);
		const tidToTopic = _.zipObject(tids, topicData);
		postData.forEach((post) => {
			if (post && tidToTopic[post.tid]) {
				post.cid = tidToTopic[post.tid].cid;
			}
		});
		postData = postData.filter(post => tidToTopic[post.tid].deleted !== 1);
		await postsSave(postData);
	}, {
		batch: batchSize,
	});
}

async function postsSave(posts) {
	posts = posts.filter(
		p => p && utils.isNumber(p.pid) && parseInt(p.deleted, 10) !== 1 &&
		!pluginConfig.excludeCategories.includes(String(p.cid))
	);

	let data = posts.map((postData) => {
		const indexData = {};
		if (postData.content) {
			indexData.content = postData.content;
		}
		if (postData.cid) {
			indexData.cid = postData.cid;
		}
		if (postData.uid) {
			indexData.uid = postData.uid;
		}
		if (!Object.keys(indexData).length) {
			return null;
		}
		return indexData;
	});

	const pids = posts.filter((p, index) => !!data[index]).map(p => p.pid);
	data = data.filter(Boolean);
	if (!data.length) {
		return;
	}

	const result = await plugins.hooks.fire('filter:search.indexPosts', { data: data, pids: pids, posts: posts });
	await db.searchIndex('post', result.data, result.pids);
	await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'postsIndexed', result.pids.length);
}

async function reIndexMessages() {
	await batch.processSortedSet(`messages:mid`, async (mids) => {
		let messageData = await messaging.getMessagesFields(mids, ['mid', 'content', 'roomId', 'fromuid', 'deleted', 'system']);
		messageData = messageData.filter(p => p && p.deleted !== 1 && p.system !== 1);
		await messagesSave(messageData);
	}, {
		batch: batchSize,
	});
}

async function messagesSave(msgs) {
	msgs = msgs.filter(m => m && m.mid && parseInt(m.deleted, 10) !== 1 && parseInt(m.system, 10) !== 1);

	let data = msgs.map((msgData) => {
		const indexData = {};
		if (msgData.content) {
			indexData.content = msgData.content;
		}
		if (msgData.roomId) {
			indexData.roomId = msgData.roomId;
		}
		if (msgData.fromuid) {
			indexData.uid = msgData.fromuid;
		}
		if (!Object.keys(indexData).length) {
			return null;
		}
		return indexData;
	});

	const mids = msgs.filter((msg, index) => !!data[index]).map(msg => msg.mid);
	data = data.filter(Boolean);
	if (!data.length) {
		return;
	}

	const result = await plugins.hooks.fire('filter:search.indexMessages', { data: data, mids: mids, messages: msgs });
	await searchModule.chat.index(result.data, result.mids);
	await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'messagesIndexed', result.mids.length);
}

async function searchRemove(key, ids) {
	await db.searchRemove(key, ids);
	if (key === 'topic') {
		await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'topicsIndexed', -ids.length);
	} else if (key === 'post') {
		await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'postsIndexed', -ids.length);
	} else if (key === 'chat') {
		await db.incrObjectFieldBy('nodebb-plugin-dbsearch', 'messagesIndexed', -ids.length);
	}
}

async function reIndexTids(tids) {
	if (!Array.isArray(tids) || !tids.length) {
		return;
	}

	let topicData = await topics.getTopicsFields(tids, ['tid', 'title', 'uid', 'cid', 'deleted', 'mainPid']);
	topicData = topicData.filter(t => t.tid && t.deleted !== 1);
	if (!topicData.length) {
		return;
	}

	async function reIndexTopicsPids(topicData) {
		await Promise.all(topicData.map(t => reIndexTopicPids(t)));
	}

	async function reIndexTopicPids(topic) {
		await reIndexPids([topic.mainPid], topic);
		await batch.processSortedSet(`tid:${topic.tid}:posts`, async (pids) => {
			await reIndexPids(pids, topic);
		}, {
			batch: batchSize,
		});
	}

	await Promise.all([
		topicsSave(topicData),
		reIndexTopicsPids(topicData),
	]);
}

async function reIndexPids(pids, topic) {
	if (!Array.isArray(pids) || !pids.length) {
		winston.warn('[nodebb-plugin-dbsearch] invalid-pid, skipping');
		return;
	}
	if (parseInt(topic.deleted, 10) === 1) {
		return;
	}
	const postData = await posts.getPostsFields(pids, ['pid', 'content', 'uid', 'tid', 'deleted']);
	postData.forEach((post) => {
		if (post && topic) {
			post.cid = topic.cid;
		}
	});
	await postsSave(postData);
}

async function renderAdmin(req, res) {
	const results = await getGlobalAndPluginData();
	results.plugin.progressData = await getProgress();
	results.plugin.title = 'DB Search';
	res.render('admin/plugins/dbsearch', results.plugin);
}

async function save(req, res) {
	if (utils.isNumber(req.body.postLimit) && utils.isNumber(req.body.topicLimit)) {
		const data = {
			postLimit: req.body.postLimit,
			topicLimit: req.body.topicLimit,
			excludeCategories: JSON.stringify(req.body.excludeCategories || []),
		};

		await db.setObject('nodebb-plugin-dbsearch', data);

		pluginConfig.postLimit = data.postLimit;
		pluginConfig.topicLimit = data.topicLimit;
		pluginConfig.excludeCategories = req.body.excludeCategories || [];
		pubsub.publish('nodebb-plugin-dbsearch:settings:save', pluginConfig);
		res.json('Settings saved!');
	}
}

socketAdmin.plugins.dbsearch = {};
socketAdmin.plugins.dbsearch.checkProgress = async function () {
	return await getProgress();
};

async function getPluginData() {
	const data = await db.getObject('nodebb-plugin-dbsearch') || {};
	data.topicsIndexed = parseInt(data.topicsIndexed, 10) || 0;
	data.postsIndexed = parseInt(data.postsIndexed, 10) || 0;
	data.messagesIndexed = parseInt(data.messagesIndexed, 10) || 0;
	data.excludeCategories = data.excludeCategories || '[]';
	data.postLimit = data.postLimit || defaultPostLimit;
	data.topicLimit = data.topicLimit || defaultTopicLimit;
	data.indexLanguage = data.indexLanguage || 'en';
	data.working = data.working || 0;

	try {
		data.excludeCategories = JSON.parse(data.excludeCategories);
	} catch (err) {
		winston.error(err);
		data.excludeCategories = [];
	}
	return data;
}

async function getGlobalAndPluginData() {
	const [global, plugin, allCategories] = await Promise.all([
		db.getObjectFields('global', ['topicCount', 'postCount', 'messageCount']),
		getPluginData(),
		categories.buildForSelectAll(['value', 'text']),
	]);

	const languageSupported = nconf.get('database') === 'mongo' || nconf.get('database') === 'postgres';
	const languages = Object.keys(languageLookup).map(
		code => ({ name: languageLookup[code], value: code, selected: false })
	);

	plugin.languageSupported = languageSupported;
	plugin.languages = languages;

	plugin.allCategories = allCategories;
	plugin.topicCount = parseInt(global.topicCount, 10);
	plugin.postCount = parseInt(global.postCount, 10);
	plugin.messageCount = parseInt(global.messageCount, 10);
	plugin.topicLimit = plugin.topicLimit || defaultTopicLimit;
	plugin.postLimit = plugin.postLimit || defaultPostLimit;
	plugin.topicsIndexed = plugin.topicsIndexed > plugin.topicCount ? plugin.topicCount : plugin.topicsIndexed;
	plugin.postsIndexed = plugin.postsIndexed > plugin.postCount ? plugin.postCount : plugin.postsIndexed;
	plugin.messagesIndexed = plugin.messagesIndexed > plugin.messageCount ? plugin.messageCount : plugin.messagesIndexed;
	plugin.languageSupported = languageSupported;
	plugin.languages = languages;
	plugin.indexLanguage = plugin.indexLanguage || 'en';
	plugin.languages.forEach((language) => {
		language.selected = language && language.value === plugin.indexLanguage;
	});

	plugin.allCategories.forEach((category) => {
		category.selected = category && plugin.excludeCategories.includes(String(category.value));
	});

	return { global: global, plugin: plugin, allCategories: allCategories };
}

async function getProgress() {
	const [global, pluginData] = await Promise.all([
		db.getObjectFields('global', ['topicCount', 'postCount', 'messageCount']),
		getPluginData(),
	]);
	const topicCount = parseInt(global.topicCount, 10);
	const postCount = parseInt(global.postCount, 10);
	const messageCount = parseInt(global.messageCount, 10);
	const topicsPercent = topicCount ? (pluginData.topicsIndexed / topicCount) * 100 : 0;
	const postsPercent = postCount ? (pluginData.postsIndexed / postCount) * 100 : 0;
	const messagesPercent = messageCount ? (pluginData.messagesIndexed / messageCount) * 100 : 0;
	return {
		topicsPercent: Math.max(0, Math.min(100, topicsPercent.toFixed(2))),
		postsPercent: Math.max(0, Math.min(100, postsPercent.toFixed(2))),
		messagesPercent: Math.max(0, Math.min(100, messagesPercent.toFixed(2))),
		topicsIndexed: topicsPercent >= 100 ? topicCount : Math.max(0, pluginData.topicsIndexed),
		postsIndexed: postsPercent >= 100 ? postCount : Math.max(0, pluginData.postsIndexed),
		messagesIndexed: messagesPercent >= 100 ? messageCount : Math.max(0, pluginData.messagesIndexed),
		working: pluginData.working,
	};
}

socketAdmin.plugins.dbsearch.reindex = function (socket, data, callback) {
	setTimeout(async () => {
		try {
			await search.reindex();
		} catch (err) {
			winston.error(err);
		}
	}, 0);
	callback();
};

socketAdmin.plugins.dbsearch.clearIndex = async function () {
	setTimeout(async () => {
		try {
			await clearIndex();
		} catch (err) {
			winston.error(err.stack);
		}
	}, 0);
};

async function clearIndex() {
	await db.setObject('nodebb-plugin-dbsearch', {
		working: 1,
	});

	await Promise.all([
		clearSet('topics:tid', 'topic'),
		clearSet('posts:pid', 'post'),
		clearSet('messages:mid', 'chat'),
	]);

	await db.setObject('nodebb-plugin-dbsearch', {
		postsIndexed: 0,
		topicsIndexed: 0,
		messagesIndexed: 0,
		working: 0,
	});
}

async function clearSet(set, key) {
	await batch.processSortedSet(set, async (ids) => {
		await searchRemove(key, ids);
	}, {
		batch: batchSize,
	});
}

socketAdmin.plugins.dbsearch.changeLanguage = async function (socket, language) {
	await searchModule.changeIndexLanguage(convertLanguageName(language));
	await db.setObject('nodebb-plugin-dbsearch', { indexLanguage: language });
};

const admin = {};
admin.menu = function (custom_header, callback) {
	custom_header.plugins.push({
		route: '/plugins/dbsearch',
		icon: 'fa-search',
		name: 'DB Search',
	});

	callback(null, custom_header);
};

search.admin = admin;
