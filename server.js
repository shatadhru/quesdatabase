const express = require('express');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Load or build metadata catalog
const META_CACHE_FILE = path.join(__dirname, 'meta_cache.json');
let catalog = null;

function loadOrBuildCatalog() {
  if (fs.existsSync(META_CACHE_FILE)) {
    try {
      catalog = JSON.parse(fs.readFileSync(META_CACHE_FILE, 'utf-8'));
      console.log('Loaded structure catalog from meta_cache.json');
      return;
    } catch (err) {
      console.warn('Error reading meta_cache.json, rebuilding...', err.message);
    }
  }

  console.log('Building structure catalog...');
  const dirs = fs.readdirSync(__dirname).filter(f => {
    try {
      return fs.statSync(path.join(__dirname, f)).isDirectory() && f !== 'node_modules' && f !== 'public' && !f.startsWith('.');
    } catch {
      return false;
    }
  });

  const cat = {};
  dirs.forEach(d => {
    let cls = 'অন্যান্য / সাধারণ';
    let subject = d;
    if (d.startsWith('HSC - ')) {
      cls = 'HSC';
      subject = d.replace('HSC - ', '');
    } else if (d.startsWith('SSC - ')) {
      cls = 'SSC';
      subject = d.replace('SSC - ', '');
    }

    if (!cat[cls]) cat[cls] = {};
    if (!cat[cls][subject]) cat[cls][subject] = { folder: d, chapters: [] };

    const dirPath = path.join(__dirname, d);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.xlsx'));
    files.forEach(f => {
      let title = f.replace(/\.xlsx$/i, '');
      try {
        const wb = xlsx.readFile(path.join(dirPath, f), { sheetRows: 2 });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);
        if (rows.length > 0 && rows[0]['Chapter']) {
          title = String(rows[0]['Chapter']).trim();
        }
      } catch (e) {
        // fallback to filename
      }
      cat[cls][subject].chapters.push({
        fileName: f,
        title: title
      });
    });
  });

  catalog = cat;
  try {
    fs.writeFileSync(META_CACHE_FILE, JSON.stringify(catalog, null, 2), 'utf-8');
    console.log('Saved meta_cache.json');
  } catch (e) {
    console.warn('Could not save meta_cache.json:', e.message);
  }
}

loadOrBuildCatalog();

// In-memory cache for parsed Excel chapter questions (LRU-like cache max 50 chapters)
const questionCache = new Map();
const MAX_CACHE_SIZE = 50;

function getChapterData(folder, fileName) {
  // Security guard against path traversal
  const safeFolder = path.basename(folder);
  const safeFile = path.basename(fileName);
  const cacheKey = `${safeFolder}/${safeFile}`;

  if (questionCache.has(cacheKey)) {
    return questionCache.get(cacheKey);
  }

  const filePath = path.join(__dirname, safeFolder, safeFile);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = xlsx.utils.sheet_to_json(sheet);

  // Normalize rows
  const topics = new Set();
  const types = new Set();

  const questions = rawRows.map((r, idx) => {
    const qTopic = (r['Topic'] || 'General').toString().trim();
    const qType = (r['Question Type'] || 'General').toString().trim();
    if (qTopic) topics.add(qTopic);
    if (qType) types.add(qType);

    return {
      index: idx + 1,
      id: r['Question ID'] || `q-${idx + 1}`,
      subject: r['Subject'] || '',
      chapter: r['Chapter'] || '',
      topic: qTopic,
      type: qType,
      text: (r['Question Text'] || '').toString().trim(),
      optionA: (r['Option A'] || '').toString().trim(),
      optionB: (r['Option B'] || '').toString().trim(),
      optionC: (r['Option C'] || '').toString().trim(),
      optionD: (r['Option D'] || '').toString().trim(),
      correctIndex: (r['Correct Index'] || '').toString().trim(),
      correctAnswer: (r['Correct Answer'] || '').toString().trim(),
      explanation: (r['Explanation'] || '').toString().trim()
    };
  });

  const parsed = {
    total: questions.length,
    topics: Array.from(topics).sort(),
    types: Array.from(types).sort(),
    questions
  };

  if (questionCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = questionCache.keys().next().value;
    questionCache.delete(oldestKey);
  }
  questionCache.set(cacheKey, parsed);

  return parsed;
}

// Enable CORS for external API calls
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// API Routes
// 1. Get full structure tree
app.get('/api/structure', (req, res) => {
  if (!catalog) loadOrBuildCatalog();
  res.json(catalog);
});

// 2. Get list of available classes
app.get('/api/classes', (req, res) => {
  if (!catalog) loadOrBuildCatalog();
  res.json(Object.keys(catalog));
});

// 3. Get list of subjects for a class
app.get('/api/subjects', (req, res) => {
  if (!catalog) loadOrBuildCatalog();
  const cls = req.query.class || 'HSC';
  const subjects = catalog[cls] ? Object.keys(catalog[cls]) : [];
  res.json(subjects);
});

// 4. Get chapters for a class & subject
app.get('/api/chapters', (req, res) => {
  if (!catalog) loadOrBuildCatalog();
  const { class: cls = 'HSC', subject } = req.query;
  if (!subject) return res.status(400).json({ error: 'Missing subject parameter' });

  const subjData = catalog[cls]?.[subject];
  if (!subjData) return res.status(404).json({ error: 'Subject not found' });

  const chapters = subjData.chapters.map((ch, idx) => ({
    index: idx + 1,
    title: ch.title,
    fileName: ch.fileName,
    folder: subjData.folder
  }));
  res.json(chapters);
});

// 5. Get questions with query params (supports folder+file OR class+subject+chapter)
app.get('/api/questions', (req, res) => {
  let { folder, file, class: cls, subject, chapter, topic, type, search, page = 1, limit = 25 } = req.query;

  // Resolve folder and file from class + subject + chapter if provided
  if ((!folder || !file) && (cls || subject)) {
    if (!catalog) loadOrBuildCatalog();
    const resolvedCls = cls || 'HSC';
    const subjData = catalog[resolvedCls]?.[subject];
    if (subjData) {
      folder = subjData.folder;
      if (chapter) {
        const chNum = parseInt(chapter, 10);
        if (!isNaN(chNum) && chNum >= 1 && chNum <= subjData.chapters.length) {
          file = subjData.chapters[chNum - 1].fileName;
        } else {
          const match = subjData.chapters.find(c => c.title.includes(chapter) || c.fileName.includes(chapter));
          if (match) file = match.fileName;
        }
      }
      if (!file && subjData.chapters.length > 0) {
        file = subjData.chapters[0].fileName;
      }
    }
  }

  if (!folder || !file) {
    return res.status(400).json({ 
      error: 'Provide either (?folder=...&file=...) or (?class=...&subject=...&chapter=...)',
      example: '/api/questions?class=HSC&subject=উচ্চতর গণিত ১ম পত্র&chapter=1'
    });
  }

  const data = getChapterData(folder, file);
  if (!data) {
    return res.status(404).json({ error: 'Chapter file not found' });
  }

  let filtered = data.questions;

  // Filter by topic
  if (topic && topic !== 'all') {
    filtered = filtered.filter(q => q.topic.toLowerCase() === topic.toLowerCase());
  }

  // Filter by question type
  if (type && type !== 'all') {
    filtered = filtered.filter(q => q.type.toLowerCase() === type.toLowerCase());
  }

  // Filter by search keyword
  if (search && search.trim() !== '') {
    const qSearch = search.trim().toLowerCase();
    filtered = filtered.filter(q => 
      q.text.toLowerCase().includes(qSearch) ||
      q.optionA.toLowerCase().includes(qSearch) ||
      q.optionB.toLowerCase().includes(qSearch) ||
      q.optionC.toLowerCase().includes(qSearch) ||
      q.optionD.toLowerCase().includes(qSearch) ||
      q.correctAnswer.toLowerCase().includes(qSearch) ||
      q.explanation.toLowerCase().includes(qSearch) ||
      q.id.toLowerCase().includes(qSearch)
    );
  }

  const totalFiltered = filtered.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = limit === 'all' ? totalFiltered : Math.max(1, parseInt(limit, 10) || 25);
  const totalPages = pageSize > 0 ? Math.ceil(totalFiltered / pageSize) : 1;

  const startIndex = (pageNum - 1) * pageSize;
  const paginatedQuestions = limit === 'all' ? filtered : filtered.slice(startIndex, startIndex + pageSize);

  res.json({
    folder,
    file,
    totalInChapter: data.total,
    totalFiltered,
    page: pageNum,
    pageSize,
    totalPages,
    topics: data.topics,
    types: data.types,
    questions: paginatedQuestions
  });
});

// 6. Get random questions for quiz generation
app.get('/api/random', (req, res) => {
  const { class: cls = 'HSC', subject = 'উচ্চতর গণিত ১ম পত্র', chapter = 1, count = 10 } = req.query;
  if (!catalog) loadOrBuildCatalog();

  const subjData = catalog[cls]?.[subject];
  if (!subjData) return res.status(404).json({ error: 'Subject not found' });

  const chIdx = Math.max(0, parseInt(chapter, 10) - 1 || 0);
  const ch = subjData.chapters[chIdx] || subjData.chapters[0];
  if (!ch) return res.status(404).json({ error: 'No chapters available' });

  const data = getChapterData(subjData.folder, ch.fileName);
  if (!data) return res.status(404).json({ error: 'Failed to read chapter' });

  const n = Math.min(parseInt(count, 10) || 10, data.questions.length);
  const shuffled = [...data.questions].sort(() => 0.5 - Math.random()).slice(0, n);

  res.json({
    class: cls,
    subject,
    chapter: ch.title,
    count: shuffled.length,
    questions: shuffled
  });
});

// Catch-all route to serve index.html (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
