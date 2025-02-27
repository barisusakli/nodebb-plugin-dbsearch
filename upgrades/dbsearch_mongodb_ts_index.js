'use strict';


const db = module.parent.require('./database');

module.exports = {
	name: 'Add timestamp field to searchtopic searchpost collections',
	timestamp: Date.UTC(2025, 1, 18),
	method: async function () {
		const { progress } = this;
		const nconf = require.main.require('nconf');
		const batch = require.main.require('./src/batch');
		const isMongo = nconf.get('database') === 'mongo';
		if (!isMongo) {
			return;
		}

		async function addTsField(collection, docs) {
			await batch.processArray(docs, async (docData) => {
				const ids = docData.map(d => d._id);
				let itemData = [];
				if (collection === 'searchtopic') {
					itemData = await db.getObjectsFields(ids.map(id => `topic:${id}`), ['timestamp']);
				} else if (collection === 'searchpost') {
					itemData = await db.getObjectsFields(ids.map(id => `post:${id}`), ['timestamp']);
				}
				const bulk = db.client.collection(collection).initializeUnorderedBulkOp();
				ids.forEach(
					(id, index) => bulk.find({ _id: id }).updateOne({ $set: { ts: itemData[index].timestamp } })
				);
				await bulk.execute();
				progress.incr(docData.length);
			}, {
				batch: 500,
			});
		}
		await db.client.collection('searchtopic').createIndex({ ts: 1 }, { });
		await db.client.collection('searchpost').createIndex({ ts: 1 }, { });

		const projection = { _id: 1 };
		const topics = await db.client.collection('searchtopic').find({}, { projection }).toArray();
		const posts = await db.client.collection('searchpost').find({}, { projection }).toArray();

		progress.total = topics.length + posts.length;

		await addTsField('searchtopic', topics);
		await addTsField('searchpost', posts);
	},
};
