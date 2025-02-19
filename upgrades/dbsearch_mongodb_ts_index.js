'use strict';


const db = module.parent.require('./database');

module.exports = {
	name: 'Add timestamp field to searchtopic searchpost collections',
	timestamp: Date.UTC(2025, 1, 18),
	method: async function () {
		const { progress } = this;
		const nconf = require.main.require('nconf');
		const isMongo = nconf.get('database') === 'mongo';
		if (!isMongo) {
			return;
		}

		async function addTsField(collection, docs) {
			for (const doc of docs) {
				if (doc._id) {
					const stringId = doc._id;
					let ts = 0;
					if (collection === 'searchtopic') {
						// eslint-disable-next-line no-await-in-loop
						ts = await db.getObjectField(`topic:${stringId}`, 'timestamp');
					} else if (collection === 'searchpost') {
						// eslint-disable-next-line no-await-in-loop
						ts = await db.getObjectField(`post:${stringId}`, 'timestamp');
					}
					ts = parseInt(ts, 10);
					if (ts) {
						// eslint-disable-next-line no-await-in-loop
						await db.client.collection(collection).updateOne({
							_id: stringId,
						}, { $set: { ts } });
					}
				}
				progress.incr(1);
			}
		}
		await db.client.collection('searchtopic').createIndex({ ts: 1 }, { background: true });
		await db.client.collection('searchpost').createIndex({ ts: 1 }, { background: true });

		const topics = await db.client.collection('searchtopic').find({}).toArray();
		const posts = await db.client.collection('searchpost').find({}).toArray();

		progress.total = topics.length + posts.length;

		await addTsField('searchtopic', topics);
		await addTsField('searchpost', posts);
	},
};
