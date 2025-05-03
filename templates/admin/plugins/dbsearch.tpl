<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-0 mb-4" tabindex="0">
			<div class="card">
				<div class="card-body row">
					<div class="col-6">
						<div class="mb-3">
							<div class="alert alert-info">
								[[dbsearch:admin.topicsIndexed]] <strong id="topics-indexed">{topicsIndexed}</strong> /
								<strong>{topicCount}</strong>
							</div>

							<div class="progress" style="height:24px;">
								<div class="topic-progress progress-bar" role="progressbar" aria-valuenow="0"
									aria-valuemin="0" aria-valuemax="100"
									style="width:{progressData.topicsPercent}%;min-width: 2em;">
									{progressData.topicsPercent}%
								</div>
							</div>
						</div>
						<div class="mb-3">
							<div class="alert alert-info">
								[[dbsearch:admin.postsIndexed]] <strong id="posts-indexed">{postsIndexed}</strong> /
								<strong>{postCount}</strong>
							</div>
							<div class="progress" style="height:24px;">
								<div class="post-progress progress-bar" role="progressbar" aria-valuenow="0"
									aria-valuemin="0" aria-valuemax="100"
									style="width:{progressData.postsPercent}%;min-width: 2em;">
									{progressData.postsPercent}%
								</div>
							</div>
						</div>

						<div class="mb-3">
							<div class="alert alert-info">
								[[dbsearch:admin.messagesIndexed]] <strong
									id="messages-indexed">{messagesIndexed}</strong> / <strong>{messageCount}</strong>
							</div>
							<div class="progress" style="height:24px;">
								<div class="message-progress progress-bar" role="progressbar" aria-valuenow="0"
									aria-valuemin="0" aria-valuemax="100"
									style="width:{progressData.messagesPercent}%;min-width: 2em;">
									{progressData.messagesPercent}%
								</div>
							</div>
						</div>

						<button class="btn btn-warning" id="reindex" <!-- IF working -->disabled<!-- ENDIF working -->>
							[[dbsearch:admin.reindex]]
						</button>
						<button class="btn btn-danger" id="clear-index">
							[[dbsearch:admin.clearIndex]]
						</button>
						<span id="work-in-progress" class="<!-- IF !working -->hidden<!-- ENDIF !working -->">
							<i class="fa fa-gear fa-spin"></i> [[dbsearch:admin.working]]
						</span>

						<hr />

						<!-- IF languageSupported -->
						<div class="mb-3">
							<label class="form-label">[[dbsearch:admin.indexLanguage]]</label>
							<select class="form-select" id="indexLanguage">
								<!-- BEGIN languages -->
								<option value="{languages.value}" <!-- IF languages.selected -->
									selected<!-- ENDIF languages.selected -->>{languages.name}</option>
								<!-- END languages -->
							</select>
						</div>
						<button class="btn btn-primary" id="changeLanguage">
							[[dbsearch:admin.changeLanguage]]
						</button>
						<hr />
						<!-- ENDIF languageSupported -->

						<div class="mb-3">
							<label class="form-label">[[dbsearch:admin.topicLimit]]</label>
							<input id="topicLimit" type="text" class="form-control"
								placeholder="[[dbsearch:admin.topicLimitPlaceholder]]" value="{topicLimit}">
						</div>
						<div class="mb-3">
							<label class="form-label">[[dbsearch:admin.postLimit]]</label>
							<input id="postLimit" type="text" class="form-control"
								placeholder="[[dbsearch:admin.postLimitPlaceholder]]" value="{postLimit}">
						</div>
					</div>

					<div class="col-6">
						<div class="post-search-item">
							<label class="form-label">[[dbsearch:admin.excludeCategories]]</label>
							<select multiple class="form-select" id="exclude-categories" size="30">
								<!-- BEGIN allCategories -->
								<option value="{allCategories.value}" <!-- IF allCategories.selected -->
									selected<!-- ENDIF allCategories.selected -->>{allCategories.text}</option>
								<!-- END allCategories -->
							</select>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>