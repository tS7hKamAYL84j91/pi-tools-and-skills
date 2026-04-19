# Deep-Research Skill — Search Gap Rectification

## To-Do

### 🔴 Critical
- [x] 1. Add OpenAlex API as primary academic search (`openalex_search.py`) ✅
- [x] 2. Add ArXiv search (`arxiv_search.py`) ✅
- [ ] 3. Add DDG + Jina Reader follow-up workflow step to SKILL.md
- [ ] 4. Make `scholarly_api.py` fallback to OpenAlex on rate limit
- [ ] 5. Wire all new scripts into SKILL.md (Step 1b commands, script table)

### 🟡 Important
- [ ] 6. Add environment variable docs to SKILL.md (S2_API_KEY, JINA_API_KEY, TAVILY_API_KEY, GITHUB_TOKEN)
- [ ] 7. Test Tavily engine (needs TAVILY_API_KEY — skip if not available)
- [ ] 8. Rename or alias scholarly_api.py → clarify it's Semantic Scholar specific

### 🟢 Nice to have
- [ ] 9. Auto-score confidence from metadata in script JSON output
- [ ] 10. Source deduplication by URL/DOI in post-processing