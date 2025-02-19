'use strict';


const db = module.parent.require('./database');

module.exports = {
	name: 'Fix _id convert upgrade for mongodb',
	timestamp: Date.UTC(2025, 1, 18),
	method: async function () {
		const { progress } = this;
		const nconf = require.main.require('nconf');
		const mainDB = nconf.get('database');
		if (mainDB !== 'mongo') {
			return;
		}

		async function convertIdToString(collection, docs) {
			for (const doc of docs) {
				if (doc._id) {
					const stringId = doc._id.toString();
					// eslint-disable-next-line no-await-in-loop
					await db.client.collection(collection).deleteMany({ _id: { $in: [doc._id, stringId] } });
					// eslint-disable-next-line no-await-in-loop
					await db.client.collection(collection).insertOne({
						...doc,
						_id: stringId,
					});
				}
				progress.incr(1);
			}
		}

		const posts = await db.client.collection('searchpost').find({}).toArray();
		progress.total = posts.length;
		await convertIdToString('searchpost', posts);
	},
};
