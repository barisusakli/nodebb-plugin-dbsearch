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

		async function convertIdToString(collection, docs) {
			for (const doc of docs) {
				if (doc._id) {
					const stringId = doc._id.toString();
					// eslint-disable-next-line no-await-in-loop
					await db.client.collection(collection).deleteOne({ _id: doc._id });
					// eslint-disable-next-line no-await-in-loop
					await db.client.collection(collection).insertOne({
						...doc,
						_id: stringId,
					});
				}
				progress.incr(1);
			}
		}

		if (mainDB === 'mongo') {
			const topics = await db.client.collection('searchtopic').find({}).toArray();
			const posts = await db.client.collection('searchposts').find({}).toArray();
			const chats = await db.client.collection('searchchat').find({}).toArray();

			progress.total = topics.length + posts.length + chats.length;

			await convertIdToString('searchtopic', topics);
			await convertIdToString('searchposts', posts);
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
