// ==========================================================================
// QuesEngine — Frontend Controller
// ==========================================================================

(function() {
  'use strict';

  // Application State
  const state = {
    catalog: null,
    selectedClass: '',
    selectedSubject: '',
    selectedFolder: '',
    selectedFile: '',
    selectedTopic: 'all',
    selectedType: 'all',
    searchQuery: '',
    currentPage: 1,
    pageSize: 20,
    currentMode: 'study', // 'study' | 'practice' | 'exam'
    showAllAnswers: false,
    practiceStats: { correct: 0, attempted: 0 },
    practiceAnswers: new Map(), // qId => selectedOptionLetter
    searchDebounceTimer: null
  };

  // DOM Elements Cache
  const els = {
    themeBtn: document.getElementById('btn-theme'),
    printBtn: document.getElementById('btn-print'),
    statClasses: document.getElementById('stat-classes'),
    statSubjects: document.getElementById('stat-subjects'),
    statChapters: document.getElementById('stat-chapters'),
    
    // Filters
    selectClass: document.getElementById('select-class'),
    selectSubject: document.getElementById('select-subject'),
    selectChapter: document.getElementById('select-chapter'),
    selectTopic: document.getElementById('select-topic'),
    selectType: document.getElementById('select-type'),
    inputSearch: document.getElementById('input-search'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    
    // Toolbar & Controls
    toolbar: document.getElementById('toolbar'),
    modeBtns: document.querySelectorAll('.mode-btn'),
    practiceScoreBox: document.getElementById('practice-score-box'),
    practiceScore: document.getElementById('practice-score'),
    btnResetQuiz: document.getElementById('btn-reset-quiz'),
    btnToggleAllAnswers: document.getElementById('btn-toggle-all-answers'),
    selectLimit: document.getElementById('select-limit'),
    
    // Results & Status
    statusBar: document.getElementById('status-bar'),
    currentChapterTitle: document.getElementById('current-chapter-title'),
    totalCountBadge: document.getElementById('total-count-badge'),
    paginationInfo: document.getElementById('pagination-info'),
    loadingState: document.getElementById('loading-state'),
    emptyState: document.getElementById('empty-state'),
    questionsList: document.getElementById('questions-list'),
    paginationContainer: document.getElementById('pagination-container'),
    pagePills: document.getElementById('page-pills'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page')
  };

  // Initialize
  async function init() {
    setupTheme();
    setupEventListeners();
    await loadStructure();
  }

  // ========================================================================
  // Theme Management
  // ========================================================================
  function setupTheme() {
    const savedTheme = localStorage.getItem('quesengine_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    els.themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('quesengine_theme', next);
    });
  }

  // ========================================================================
  // Load Hierarchy Structure
  // ========================================================================
  async function loadStructure() {
    try {
      const res = await fetch('/api/structure');
      if (!res.ok) throw new Error('Failed to load structure');
      state.catalog = await res.json();

      populateClasses();
      updateHeaderStats();
    } catch (err) {
      console.error('Error fetching structure:', err);
      els.emptyState.innerHTML = `
        <div class="empty-icon" style="color:var(--danger-text)">⚠️</div>
        <h3>সার্ভার সংযোগ ত্রুটি</h3>
        <p>ডাটাবেজ বা সার্ভারে সংযোগ করা যায়নি। দয়া করে সার্ভার সচল আছে কিনা দেখুন।</p>
      `;
    }
  }

  function updateHeaderStats() {
    if (!state.catalog) return;
    const classKeys = Object.keys(state.catalog);
    let subjectCount = 0;
    let chapterCount = 0;

    classKeys.forEach(cls => {
      const subjects = state.catalog[cls];
      const subjKeys = Object.keys(subjects);
      subjectCount += subjKeys.length;
      subjKeys.forEach(sub => {
        chapterCount += (subjects[sub].chapters || []).length;
      });
    });

    els.statClasses.textContent = toBengaliNumber(classKeys.length);
    els.statSubjects.textContent = toBengaliNumber(subjectCount);
    els.statChapters.textContent = toBengaliNumber(chapterCount);
  }

  // ========================================================================
  // Cascading Selectors
  // ========================================================================
  function populateClasses() {
    els.selectClass.innerHTML = '<option value="" disabled selected>শ্রেণি বাছাই করুন...</option>';
    const classes = Object.keys(state.catalog);

    classes.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      els.selectClass.appendChild(opt);
    });

    // Default select HSC if available
    if (classes.includes('HSC')) {
      els.selectClass.value = 'HSC';
      handleClassChange();
    }
  }

  function handleClassChange() {
    state.selectedClass = els.selectClass.value;
    state.selectedSubject = '';
    state.selectedFolder = '';
    state.selectedFile = '';
    state.currentPage = 1;

    // Reset Subjects
    els.selectSubject.disabled = false;
    els.selectSubject.innerHTML = '<option value="" disabled selected>বিষয় বাছাই করুন...</option>';
    els.selectChapter.disabled = true;
    els.selectChapter.innerHTML = '<option value="" disabled selected>প্রথমে বিষয় নির্বাচন করুন</option>';

    resetQuestionsView();

    const subjectsObj = state.catalog[state.selectedClass] || {};
    const subjectNames = Object.keys(subjectsObj).sort((a, b) => a.localeCompare(b, 'bn'));

    subjectNames.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub;
      opt.textContent = sub;
      els.selectSubject.appendChild(opt);
    });
  }

  function handleSubjectChange() {
    state.selectedSubject = els.selectSubject.value;
    state.selectedFile = '';
    state.currentPage = 1;

    const subjectData = state.catalog[state.selectedClass]?.[state.selectedSubject];
    if (!subjectData) return;

    state.selectedFolder = subjectData.folder;

    // Enable and populate chapters
    els.selectChapter.disabled = false;
    els.selectChapter.innerHTML = '<option value="" disabled selected>অধ্যায় বাছাই করুন...</option>';

    resetQuestionsView();

    const chapters = subjectData.chapters || [];
    chapters.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.fileName;
      opt.textContent = ch.title || ch.fileName.replace(/\.xlsx$/i, '');
      opt.dataset.title = ch.title;
      els.selectChapter.appendChild(opt);
    });

    // Auto-select first chapter to immediately wow the user!
    if (chapters.length > 0) {
      els.selectChapter.value = chapters[0].fileName;
      handleChapterChange();
    }
  }

  function handleChapterChange() {
    state.selectedFile = els.selectChapter.value;
    state.currentPage = 1;
    state.selectedTopic = 'all';
    state.selectedType = 'all';
    state.searchQuery = '';
    els.inputSearch.value = '';
    els.btnClearSearch.style.display = 'none';

    // Reset practice stats for new chapter
    resetPracticeQuiz();

    // Auto load and render questions immediately!
    fetchAndRenderQuestions();
  }

  function resetQuestionsView() {
    els.toolbar.style.display = 'none';
    els.statusBar.style.display = 'none';
    els.paginationContainer.style.display = 'none';
    els.questionsList.innerHTML = '';
    els.emptyState.style.display = 'flex';
    els.selectTopic.disabled = true;
    els.selectTopic.innerHTML = '<option value="all">সকল টপিক</option>';
    els.selectType.disabled = true;
    els.selectType.innerHTML = '<option value="all">সকল ধরন</option>';
  }

  // ========================================================================
  // Fetch & Render Questions
  // ========================================================================
  async function fetchAndRenderQuestions() {
    if (!state.selectedFolder || !state.selectedFile) return;

    showLoading(true);
    els.emptyState.style.display = 'none';

    try {
      const params = new URLSearchParams({
        folder: state.selectedFolder,
        file: state.selectedFile,
        topic: state.selectedTopic,
        type: state.selectedType,
        search: state.searchQuery,
        page: state.currentPage,
        limit: state.pageSize
      });

      const res = await fetch(`/api/questions?${params.toString()}`);
      if (!res.ok) throw new Error('Error fetching questions');
      const data = await res.json();

      updateFiltersDropdowns(data.topics, data.types);
      renderUI(data);
    } catch (err) {
      console.error('Fetch questions error:', err);
      els.questionsList.innerHTML = `
        <div class="empty-state card">
          <div class="empty-icon" style="color:var(--danger-text)">⚠️</div>
          <h3>প্রশ্ন লোড করতে সমস্যা হয়েছে</h3>
          <p>${err.message}</p>
        </div>
      `;
    } finally {
      showLoading(false);
    }
  }

  function showLoading(show) {
    els.loadingState.style.display = show ? 'flex' : 'none';
    if (show) {
      els.questionsList.style.opacity = '0.3';
    } else {
      els.questionsList.style.opacity = '1';
    }
  }

  function updateFiltersDropdowns(topics, types) {
    // Only update topic list if not already populated
    if (els.selectTopic.options.length <= 1 && topics && topics.length > 0) {
      els.selectTopic.disabled = false;
      els.selectTopic.innerHTML = '<option value="all">সকল টপিক</option>';
      topics.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        els.selectTopic.appendChild(opt);
      });
      els.selectTopic.value = state.selectedTopic;
    }

    if (els.selectType.options.length <= 1 && types && types.length > 0) {
      els.selectType.disabled = false;
      els.selectType.innerHTML = '<option value="all">সকল ধরন</option>';
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        els.selectType.appendChild(opt);
      });
      els.selectType.value = state.selectedType;
    }
  }

  // ========================================================================
  // Render Cards & MathJax Typeset
  // ========================================================================
  function renderUI(data) {
    els.toolbar.style.display = 'flex';
    els.statusBar.style.display = 'flex';

    // Update Status Bar
    const selectedOption = els.selectChapter.options[els.selectChapter.selectedIndex];
    const chapterName = selectedOption ? selectedOption.textContent : state.selectedFile;
    els.currentChapterTitle.textContent = `${state.selectedSubject} — ${chapterName}`;
    els.totalCountBadge.textContent = `${toBengaliNumber(data.totalFiltered)} টি প্রশ্ন পাওয়া গেছে`;

    if (data.totalFiltered === 0) {
      els.questionsList.innerHTML = `
        <div class="empty-state card">
          <div class="empty-icon">🔍</div>
          <h3>কোনো প্রশ্ন পাওয়া যায়নি</h3>
          <p>আপনার ফিল্টার বা অনুসন্ধানের সাথে মিল রেখে কোনো প্রশ্ন পাওয়া যায়নি। অন্য টপিক বা কি-ওয়ার্ড দিয়ে চেষ্টা করুন।</p>
        </div>
      `;
      els.paginationContainer.style.display = 'none';
      return;
    }

    // Build Question Cards
    const htmlCards = data.questions.map((q, idx) => {
      const qSerial = (data.page - 1) * (data.pageSize === data.totalFiltered ? 0 : data.pageSize) + idx + 1;
      return createQuestionCardHtml(q, qSerial);
    }).join('');

    els.questionsList.innerHTML = htmlCards;

    // Attach Event Handlers to Question Cards
    attachQuestionEvents();

    // Render Pagination
    renderPagination(data);

    // Typeset Mathematical Equations with MathJax
    triggerMathJax();

    // Re-apply Show All Answers state if enabled
    if (state.showAllAnswers) {
      document.querySelectorAll('.explanation-card').forEach(card => card.classList.add('show'));
    }
  }

  function createQuestionCardHtml(q, serial) {
    const isMCQ = Boolean(q.optionA || q.optionB || q.optionC || q.optionD);
    const typeClass = q.type && q.type.includes('সৃজনশীল') ? 'type-cq' : 'type-mcq';

    // Options HTML
    let optionsHtml = '';
    if (isMCQ) {
      const options = [
        { letter: 'A', text: q.optionA, bangla: 'ক' },
        { letter: 'B', text: q.optionB, bangla: 'খ' },
        { letter: 'C', text: q.optionC, bangla: 'গ' },
        { letter: 'D', text: q.optionD, bangla: 'ঘ' }
      ].filter(o => Boolean(o.text && o.text.trim() !== ''));

      optionsHtml = `
        <div class="options-grid" data-qid="${escapeHtml(q.id)}" data-correct-idx="${escapeHtml(q.correctIndex)}">
          ${options.map(opt => `
            <button class="option-btn" data-letter="${opt.letter}" data-qid="${escapeHtml(q.id)}">
              <span class="option-letter">${opt.letter}</span>
              <span class="option-text">${formatFormulaText(opt.text)}</span>
            </button>
          `).join('')}
        </div>
      `;
    }

    // Answer & Explanation
    const hasExplanation = Boolean(q.explanation && q.explanation.trim() !== '');
    const hasCorrectAns = Boolean(q.correctAnswer && q.correctAnswer.trim() !== 'N/A' && q.correctAnswer.trim() !== '');

    let answerHtml = '';
    if (hasCorrectAns || hasExplanation) {
      answerHtml = `
        <div class="q-answer-wrapper">
          <button class="btn-toggle-answer" data-target="exp-${escapeHtml(q.id)}">
            <span class="icon">💡</span>
            <span class="text">উত্তর ও সমাধান দেখুন</span>
          </button>
          
          <div class="explanation-card" id="exp-${escapeHtml(q.id)}">
            ${hasCorrectAns ? `
              <div class="correct-answer-header">
                <span>সঠিক উত্তর:</span>
                ${q.correctIndex && q.correctIndex !== 'N/A' ? `<span class="ans-index-tag">${escapeHtml(q.correctIndex)}</span>` : ''}
                <span>${formatFormulaText(q.correctAnswer)}</span>
              </div>
            ` : ''}
            ${hasExplanation ? `
              <div class="explanation-body">
                ${formatFormulaText(q.explanation)}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <article class="question-card" id="card-${escapeHtml(q.id)}">
        <div class="q-card-header">
          <div class="q-serial-wrap">
            <span class="q-serial">${toBengaliNumber(serial)}</span>
            <span class="q-badge ${typeClass}">${escapeHtml(q.type || 'প্রশ্ন')}</span>
            ${q.topic && q.topic !== 'All Topics' && q.topic !== 'General' ? `<span class="q-badge topic-badge">${escapeHtml(q.topic)}</span>` : ''}
          </div>
          <span class="q-id-copy" data-id="${escapeHtml(q.id)}" title="Question ID কপি করুন">ID: ${escapeHtml(q.id.slice(0, 8))}...</span>
        </div>

        <div class="q-body">
          ${formatFormulaText(q.text)}
        </div>

        ${optionsHtml}
        ${answerHtml}
      </article>
    `;
  }

  function attachQuestionEvents() {
    // 1. Toggle single explanation
    document.querySelectorAll('.btn-toggle-answer').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const card = document.getElementById(targetId);
        if (card) {
          card.classList.toggle('show');
          const isShown = card.classList.contains('show');
          btn.querySelector('.text').textContent = isShown ? 'উত্তর ও সমাধান লুকান' : 'উত্তর ও সমাধান দেখুন';
          if (isShown) triggerMathJax();
        }
      });
    });

    // 2. Option button clicks (Practice / Quiz Mode or Study Mode)
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qid = btn.getAttribute('data-qid');
        const letter = btn.getAttribute('data-letter');
        const grid = btn.closest('.options-grid');
        const correctIdx = (grid.getAttribute('data-correct-idx') || '').trim().toUpperCase();

        if (state.currentMode === 'practice') {
          handlePracticeAnswer(qid, letter, correctIdx, grid);
        } else if (state.currentMode === 'study') {
          // In study mode, clicking an option highlights the correct one and opens explanation
          revealCardAnswer(qid, correctIdx, grid);
        }
      });
    });

    // 3. Copy Question ID
    document.querySelectorAll('.q-id-copy').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        navigator.clipboard.writeText(id).then(() => {
          const old = el.textContent;
          el.textContent = '✓ Copied!';
          setTimeout(() => { el.textContent = old; }, 1500);
        });
      });
    });
  }

  function handlePracticeAnswer(qid, selectedLetter, correctIdx, grid) {
    if (state.practiceAnswers.has(qid)) return; // Already answered
    state.practiceAnswers.set(qid, selectedLetter);

    const isCorrect = selectedLetter === correctIdx;
    state.practiceStats.attempted++;
    if (isCorrect) state.practiceStats.correct++;

    updatePracticeScoreUI();

    const buttons = grid.querySelectorAll('.option-btn');
    buttons.forEach(btn => {
      const btnLetter = btn.getAttribute('data-letter');
      btn.disabled = true;

      if (btnLetter === selectedLetter) {
        btn.classList.add(isCorrect ? 'selected-correct' : 'selected-wrong');
      }
      if (!isCorrect && btnLetter === correctIdx) {
        btn.classList.add('reveal-correct');
      }
    });

    // Automatically reveal explanation
    const expCard = document.getElementById(`exp-${qid}`);
    if (expCard) {
      expCard.classList.add('show');
      triggerMathJax();
    }
  }

  function revealCardAnswer(qid, correctIdx, grid) {
    const buttons = grid.querySelectorAll('.option-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-letter') === correctIdx) {
        btn.classList.add('reveal-correct');
      }
    });
    const expCard = document.getElementById(`exp-${qid}`);
    if (expCard) {
      expCard.classList.add('show');
      triggerMathJax();
    }
  }

  function updatePracticeScoreUI() {
    const pct = state.practiceStats.attempted > 0 
      ? Math.round((state.practiceStats.correct / state.practiceStats.attempted) * 100) 
      : 0;
    els.practiceScore.textContent = `${toBengaliNumber(state.practiceStats.correct)} / ${toBengaliNumber(state.practiceStats.attempted)} (${toBengaliNumber(pct)}%)`;
  }

  function resetPracticeQuiz() {
    state.practiceStats = { correct: 0, attempted: 0 };
    state.practiceAnswers.clear();
    updatePracticeScoreUI();
  }

  // ========================================================================
  // MathJax Trigger Lifecycle
  // ========================================================================
  function triggerMathJax() {
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([els.questionsList])
        .catch(err => console.warn('MathJax typesetting error:', err));
    }
  }

  // Format equations and safely preserve LaTeX
  function formatFormulaText(raw) {
    if (!raw) return '';
    let str = String(raw);

    // Escape raw HTML entities to prevent malformed tags while preserving LaTeX
    str = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert newlines to breaks
    str = str.replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');

    return str;
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toBengaliNumber(num) {
    const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(num).replace(/[0-9]/g, d => bnDigits[d]);
  }

  // ========================================================================
  // Pagination
  // ========================================================================
  function renderPagination(data) {
    if (data.totalPages <= 1) {
      els.paginationContainer.style.display = 'none';
      els.paginationInfo.textContent = '';
      return;
    }

    els.paginationContainer.style.display = 'flex';
    els.paginationInfo.textContent = `পৃষ্ঠা ${toBengaliNumber(data.page)} / ${toBengaliNumber(data.totalPages)}`;

    els.btnPrevPage.disabled = data.page <= 1;
    els.btnNextPage.disabled = data.page >= data.totalPages;

    // Build page numbers pills
    const pills = [];
    const maxVisible = 7;
    let start = Math.max(1, data.page - 3);
    let end = Math.min(data.totalPages, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
      pills.push(`<button class="page-pill" data-page="1">১</button>`);
      if (start > 2) pills.push(`<span class="page-ellipsis">...</span>`);
    }

    for (let p = start; p <= end; p++) {
      pills.push(`<button class="page-pill ${p === data.page ? 'active' : ''}" data-page="${p}">${toBengaliNumber(p)}</button>`);
    }

    if (end < data.totalPages) {
      if (end < data.totalPages - 1) pills.push(`<span class="page-ellipsis">...</span>`);
      pills.push(`<button class="page-pill" data-page="${data.totalPages}">${toBengaliNumber(data.totalPages)}</button>`);
    }

    els.pagePills.innerHTML = pills.join('');

    // Attach listeners
    els.pagePills.querySelectorAll('.page-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPage = parseInt(btn.getAttribute('data-page'), 10);
        if (targetPage !== state.currentPage) {
          state.currentPage = targetPage;
          fetchAndRenderQuestions();
          window.scrollTo({ top: els.toolbar.offsetTop - 80, behavior: 'smooth' });
        }
      });
    });
  }

  // ========================================================================
  // Event Listeners Setup
  // ========================================================================
  function setupEventListeners() {
    // Cascading Dropdowns
    els.selectClass.addEventListener('change', handleClassChange);
    els.selectSubject.addEventListener('change', handleSubjectChange);
    els.selectChapter.addEventListener('change', handleChapterChange);

    // Filters
    els.selectTopic.addEventListener('change', () => {
      state.selectedTopic = els.selectTopic.value;
      state.currentPage = 1;
      fetchAndRenderQuestions();
    });

    els.selectType.addEventListener('change', () => {
      state.selectedType = els.selectType.value;
      state.currentPage = 1;
      fetchAndRenderQuestions();
    });

    els.selectLimit.addEventListener('change', () => {
      state.pageSize = els.selectLimit.value;
      state.currentPage = 1;
      fetchAndRenderQuestions();
    });

    // Search with 300ms debounce
    els.inputSearch.addEventListener('input', () => {
      const val = els.inputSearch.value.trim();
      els.btnClearSearch.style.display = val ? 'inline-block' : 'none';

      clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = setTimeout(() => {
        state.searchQuery = val;
        state.currentPage = 1;
        fetchAndRenderQuestions();
      }, 300);
    });

    els.btnClearSearch.addEventListener('click', () => {
      els.inputSearch.value = '';
      els.btnClearSearch.style.display = 'none';
      state.searchQuery = '';
      state.currentPage = 1;
      fetchAndRenderQuestions();
    });

    // Pagination buttons
    els.btnPrevPage.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        fetchAndRenderQuestions();
        window.scrollTo({ top: els.toolbar.offsetTop - 80, behavior: 'smooth' });
      }
    });

    els.btnNextPage.addEventListener('click', () => {
      state.currentPage++;
      fetchAndRenderQuestions();
      window.scrollTo({ top: els.toolbar.offsetTop - 80, behavior: 'smooth' });
    });

    // View Modes
    els.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.getAttribute('data-mode');
        state.currentMode = mode;

        document.body.classList.remove('mode-exam', 'mode-practice', 'mode-study');
        document.body.classList.add(`mode-${mode}`);

        els.practiceScoreBox.style.display = mode === 'practice' ? 'flex' : 'none';

        if (mode === 'exam') {
          // Hide all explanations
          document.querySelectorAll('.explanation-card').forEach(card => card.classList.remove('show'));
        }
      });
    });

    // Reset Quiz
    els.btnResetQuiz.addEventListener('click', () => {
      resetPracticeQuiz();
      fetchAndRenderQuestions();
    });

    // Master Toggle All Answers
    els.btnToggleAllAnswers.addEventListener('click', () => {
      state.showAllAnswers = !state.showAllAnswers;
      const textSpan = els.btnToggleAllAnswers.querySelector('.text');
      const iconSpan = els.btnToggleAllAnswers.querySelector('.icon');

      document.querySelectorAll('.explanation-card').forEach(card => {
        if (state.showAllAnswers) {
          card.classList.add('show');
        } else {
          card.classList.remove('show');
        }
      });

      if (state.showAllAnswers) {
        textSpan.textContent = 'সকল উত্তর লুকান';
        iconSpan.textContent = '🙈';
        triggerMathJax();
      } else {
        textSpan.textContent = 'সকল উত্তর দেখান';
        iconSpan.textContent = '👁️';
      }
    });

    // Print
    els.printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Start on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
