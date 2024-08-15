<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 px-0 mb-4" tabindex="0">
			<div class="card">
				<div class="card-header">DB Search</div>
				<div class="card-body row">
					<div class="col-6">
						<div class="mb-3">
							<div class="alert alert-info">
								색인한 토픽: <strong id="topics-indexed">{topicsIndexed}</strong> / <strong>{topicCount}</strong>
							</div>

							<div class="progress" style="height:24px;">
								<div class="topic-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:{progressData.topicsPercent}%;min-width: 2em;">{progressData.topicsPercent}%</div>
							</div>
						</div>
						<div class="mb-3">
							<div class="alert alert-info">
								색인한 게시물: <strong id="posts-indexed">{postsIndexed}</strong> / <strong>{postCount}</strong>
							</div>
							<div class="progress" style="height:24px;">
								<div class="post-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:{progressData.postsPercent}%;min-width: 2em;">{progressData.postsPercent}%</div>
							</div>
						</div>

						<div class="mb-3">
							<div class="alert alert-info">
								색인한 메시지: <strong id="messages-indexed">{messagesIndexed}</strong> / <strong>{messageCount}</strong>
							</div>
							<div class="progress" style="height:24px;">
								<div class="message-progress progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:{progressData.messagesPercent}%;min-width: 2em;">{progressData.messagesPercent}%</div>
							</div>
						</div>

						<button class="btn btn-warning" id="reindex" <!-- IF working -->disabled<!-- ENDIF working -->>재색인</button>
						<button class="btn btn-danger" id="clear-index">색인 비우기</button>
						<span id="work-in-progress" class="<!-- IF !working -->hidden<!-- ENDIF !working -->">
							<i class="fa fa-gear fa-spin"></i> Working...
						</span>

						<hr/>

						<!-- IF languageSupported -->
						<div class="mb-3">
							<label class="form-label">색인 대상 언어(GIN 설정이 되어있어야 사용가능)</label>
							<select class="form-select" id="indexLanguage">
								<!-- BEGIN languages -->
								<option value="{languages.value}" <!-- IF languages.selected -->selected<!-- ENDIF languages.selected -->>{languages.name}</option>
								<!-- END languages -->
							</select>
						</div>
						<button class="btn btn-primary" id="changeLanguage">언어 변경</button>
						<hr/>
						<!-- ENDIF languageSupported -->

						<div class="mb-3">
							<label class="form-label">주제 제한</label>
							<input id="topicLimit" type="text" class="form-control" placeholder="Number of topics to return" value="{topicLimit}">
						</div>
						<div class="mb-3">
							<label class="form-label">게시물 제한</label>
							<input id="postLimit" type="text" class="form-control" placeholder="Number of posts to return" value="{postLimit}">
						</div>
					</div>

					<div class="col-6">
						<div class="post-search-item">
							<label class="form-label">색인 생성에서 제외할 카테고리 선택</label>
							<select multiple class="form-select" id="exclude-categories" size="30">
								<!-- BEGIN allCategories -->
								<option value="{allCategories.value}" <!-- IF allCategories.selected -->selected<!-- ENDIF allCategories.selected -->>{allCategories.text}</option>
								<!-- END allCategories -->
							</select>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
