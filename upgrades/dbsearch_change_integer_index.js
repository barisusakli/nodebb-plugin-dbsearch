'use strict';


const db = module.parent.require('./database');

module.exports = {
	name: 'Changing integer search indices to string',
	timestamp: Date.UTC(2025, 0, 27),
	method: async function () {
		const { progress } = this;
		const nconf = require.main.require('nconf');
		const mainDB = nconf.get('database');
		if (mainDB === 'redis') {
			// redis is not affected, since everything is string already
			return;
		}
		const batch = require.main.require('./src/batch');
		async function convertIdToString(collection, docs) {
			await batch.processArray(docs, async (docs) => {
				await db.client.collection(collection).deleteMany({
					_id: { $in: docs.map(doc => doc._id) },
				});

				const bulk = db.client.collection(collection).initializeUnorderedBulkOp();
				docs.forEach(doc => bulk.insert({
					...doc,
					_id: doc._id.toString(),
				}));
				await bulk.execute();
			}, {
				batch: 500,
			});
			progress.incr(docs.length);
		}

		if (mainDB === 'mongo') {
			const topics = await db.client.collection('searchtopic').find({}).toArray();
			const posts = await db.client.collection('searchpost').find({}).toArray();
			const chats = await db.client.collection('searchchat').find({}).toArray();

			progress.total = topics.length + posts.length + chats.length;

			await convertIdToString('searchtopic', topics);
			await convertIdToString('searchpost', posts);
			await convertIdToString('searchchat', chats);

			return;
		}

		if (mainDB === 'postgres') {
			try {
				await db.client.query('ALTER TABLE searchtopic ALTER COLUMN id TYPE text USING id::bigint');
				await db.client.query('ALTER TABLE searchtopic ALTER COLUMN uid TYPE text USING uid::bigint');

				await db.client.query('ALTER TABLE searchpost ALTER COLUMN id TYPE text USING id::bigint');
				await db.client.query('ALTER TABLE searchpost ALTER COLUMN uid TYPE text USING uid::bigint');

				await db.client.query('ALTER TABLE searchchat ALTER COLUMN id TYPE text USING id::bigint');
				await db.client.query('ALTER TABLE searchchat ALTER COLUMN uid TYPE text USING uid::bigint');
			} catch (err) {
				console.error(err.stack);
			}
		}
	},
};
