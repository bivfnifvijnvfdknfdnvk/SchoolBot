import React, { useState, useEffect } from 'react';
import Tree from 'react-d3-tree';
import './App.css';

// ========== НАСТРОЙКА ==========
// Список Telegram ID учителей (замените на свои)
const ADMIN_IDS: number[] = [
  1394891154, // ваш ID
  // можно добавить других через запятую
];

// ========== СТРУКТУРА ДЕРЕВА ==========
const TREE_STRUCTURE = {
  id: 'root',
  name: 'Уровень А2',
  children: [
    {
      id: 'lexica',
      name: 'Лексика',
      children: [
        { id: 'l1', name: 'Урок 1' },
        { id: 'l2', name: 'Урок 2' },
        { id: 'l3', name: 'Урок 3' },
      ]
    },
    {
      id: 'grammar',
      name: 'Грамматика',
      children: [
        { id: 'g1', name: 'Урок 1' },
        { id: 'g2', name: 'Урок 2' },
      ]
    },
    {
      id: 'speaking',
      name: 'Говорение',
      children: [
        { id: 's1', name: 'Урок 1' },
      ]
    }
  ]
};

function getAllLessonIds(node: any): string[] {
  if (!node.children) return [node.id];
  let result: string[] = [];
  node.children.forEach((child: any) => {
    result = result.concat(getAllLessonIds(child));
  });
  return result;
}

const ALL_LESSON_IDS = getAllLessonIds(TREE_STRUCTURE);

// ========== РАБОТА С ПРОГРЕССОМ И ИМЕНАМИ ==========
function getProgressKey(userId: string) {
  return `progress_${userId}`;
}

function getUserNameKey(userId: string) {
  return `userName_${userId}`;
}

function loadProgress(userId: string): Record<string, boolean> {
  const key = getProgressKey(userId);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return {};
    }
  }
  const initial: Record<string, boolean> = {};
  ALL_LESSON_IDS.forEach(id => { initial[id] = false; });
  localStorage.setItem(key, JSON.stringify(initial));
  return initial;
}

function saveProgress(userId: string, progress: Record<string, boolean>) {
  const key = getProgressKey(userId);
  localStorage.setItem(key, JSON.stringify(progress));
}

function loadUserName(userId: string): string | null {
  const key = getUserNameKey(userId);
  return localStorage.getItem(key) || null;
}

function saveUserName(userId: string, name: string) {
  const key = getUserNameKey(userId);
  localStorage.setItem(key, name);
}

function getAllStudents(): { id: string; name: string | null }[] {
  const students: { id: string; name: string | null }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('progress_')) {
      const id = key.replace('progress_', '');
      const name = loadUserName(id);
      students.push({ id, name });
    }
  }
  return students;
}

// ========== РАБОТА С ПАПКАМИ ==========
const FOLDERS_KEY = 'folders_data';

interface Folder {
  id: string;
  name: string;
  students: string[]; // userId
}

function getFolders(): Folder[] {
  const stored = localStorage.getItem(FOLDERS_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }
  return [];
}

function saveFolders(folders: Folder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function createFolder(name: string): Folder {
  const id = Date.now().toString();
  return { id, name, students: [] };
}

function addFolder(name: string) {
  const folders = getFolders();
  const newFolder = createFolder(name);
  folders.push(newFolder);
  saveFolders(folders);
  return folders;
}

function renameFolder(folderId: string, newName: string) {
  const folders = getFolders();
  const folder = folders.find(f => f.id === folderId);
  if (folder) {
    folder.name = newName;
    saveFolders(folders);
  }
  return folders;
}

function deleteFolder(folderId: string) {
  let folders = getFolders();
  const folder = folders.find(f => f.id === folderId);
  if (folder) {
    folders = folders.filter(f => f.id !== folderId);
    saveFolders(folders);
  }
  return folders;
}

function getStudentFolder(userId: string): string | null {
  const folders = getFolders();
  for (const folder of folders) {
    if (folder.students.includes(userId)) {
      return folder.id;
    }
  }
  return null;
}

function moveStudentToFolder(userId: string, folderId: string | null) {
  const folders = getFolders();
  folders.forEach(f => {
    f.students = f.students.filter(id => id !== userId);
  });
  if (folderId) {
    const target = folders.find(f => f.id === folderId);
    if (target && !target.students.includes(userId)) {
      target.students.push(userId);
    }
  }
  saveFolders(folders);
}

function deleteStudent(userId: string) {
  localStorage.removeItem(getProgressKey(userId));
  localStorage.removeItem(getUserNameKey(userId));
  const folders = getFolders();
  folders.forEach(f => {
    f.students = f.students.filter(id => id !== userId);
  });
  saveFolders(folders);
}

// ========== ПОСТРОЕНИЕ ДЕРЕВА ==========
function buildTreeForDisplay(node: any, progress: Record<string, boolean>): any {
  const isLesson = !node.children || node.children.length === 0;
  if (isLesson) {
    const completed = progress[node.id] || false;
    const statusEmoji = completed ? '✅' : '⬜';
    return {
      name: `${node.name} ${statusEmoji}`,
      __id: node.id,
      __isLesson: true,
      __completed: completed,
    };
  } else {
    const lessonNodes = getAllLessonIds(node);
    const total = lessonNodes.length;
    let completedCount = 0;
    lessonNodes.forEach(id => {
      if (progress[id]) completedCount++;
    });
    const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);
    const displayName = `${node.name} (${percent}%)`;
    return {
      name: displayName,
      children: node.children.map((child: any) => buildTreeForDisplay(child, progress)),
      __id: node.id,
      __isLesson: false,
    };
  }
}

// ========== КОМПОНЕНТ ДЛЯ УЗЛА ==========
const renderCustomNode = ({ nodeDatum, toggleNode }: any) => {
  const isLesson = nodeDatum.__isLesson;
  const completed = nodeDatum.__completed;
  const bgColor = isLesson ? (completed ? '#4CAF50' : '#FF9800') : '#2196F3';
  const radius = isLesson ? 18 : 24;
  return (
    <g>
      <circle
        r={radius}
        fill={bgColor}
        stroke="#fff"
        strokeWidth="2"
        onClick={toggleNode}
        cursor="pointer"
      />
      <text
        fill="#fff"
        stroke="none"
        strokeWidth="0"
        x={radius + 10}
        y="4"
        fontSize={isLesson ? 14 : 16}
        fontFamily="Arial, sans-serif"
        textAnchor="start"
        style={{ fontWeight: isLesson ? 'normal' : 'bold' }}
      >
        {nodeDatum.name}
      </text>
    </g>
  );
};

// ========== АДМИНКА ДЛЯ РЕДАКТИРОВАНИЯ ОДНОГО УЧЕНИКА ==========
function AdminPanel({ userId, progress, setProgress, userName }: {
  userId: string;
  progress: Record<string, boolean>;
  setProgress: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  userName: string | null;
}) {
  const allLessons = ALL_LESSON_IDS.map(id => {
    function findLesson(node: any): string | null {
      if (node.id === id) return node.name;
      if (node.children) {
        for (const child of node.children) {
          const found = findLesson(child);
          if (found) return found;
        }
      }
      return null;
    }
    const name = findLesson(TREE_STRUCTURE) || id;
    return { id, name };
  });

  const handleToggle = (lessonId: string) => {
    const newProgress = { ...progress, [lessonId]: !progress[lessonId] };
    setProgress(newProgress);
    saveProgress(userId, newProgress);
  };

  const handleSelectAll = (value: boolean) => {
    const newProgress: Record<string, boolean> = {};
    ALL_LESSON_IDS.forEach(id => { newProgress[id] = value; });
    setProgress(newProgress);
    saveProgress(userId, newProgress);
  };

  const displayName = userName || `ID: ${userId}`;

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
      <h2>Редактирование прогресса: {displayName}</h2>
      <div style={{ marginBottom: '10px' }}>
        <button onClick={() => handleSelectAll(true)} style={{ marginRight: '10px' }}>✅ Все пройдены</button>
        <button onClick={() => handleSelectAll(false)}>⬜ Все непройдены</button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {allLessons.map(lesson => (
          <li key={lesson.id} style={{ margin: '8px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={!!progress[lesson.id]}
                onChange={() => handleToggle(lesson.id)}
              />
              {lesson.name}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ========== ПАНЕЛЬ УПРАВЛЕНИЯ УЧИТЕЛЯ ==========
function TeacherDashboard({ onSelectStudent }: {
  onSelectStudent: (userId: string) => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string | null }[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const loadData = () => {
    setFolders(getFolders());
    setStudents(getAllStudents());
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateFolder = () => {
    if (newFolderName.trim() === '') return;
    addFolder(newFolderName.trim());
    setNewFolderName('');
    loadData();
  };

  const handleRenameFolder = (folderId: string) => {
    if (editingName.trim() === '') return;
    renameFolder(folderId, editingName.trim());
    setEditingFolderId(null);
    setEditingName('');
    loadData();
  };

  const handleDeleteFolder = (folderId: string) => {
    if (!confirm('Удалить папку? Все ученики из неё останутся, но без папки.')) return;
    deleteFolder(folderId);
    loadData();
  };

  const handleMoveStudent = (userId: string, folderId: string | null) => {
    moveStudentToFolder(userId, folderId);
    loadData();
  };

  const handleDeleteStudent = (userId: string, userName: string | null) => {
    if (!confirm(`Точно удалить ученика ${userName || userId}? Прогресс будет потерян.`)) return;
    deleteStudent(userId);
    loadData();
  };

  const studentsWithoutFolder = students.filter(s => getStudentFolder(s.id) === null);

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
      <h2>👨‍🏫 Панель учителя</h2>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <input
          type="text"
          placeholder="Название новой папки"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          style={{ padding: '8px', flex: 1 }}
        />
        <button onClick={handleCreateFolder}>Создать папку</button>
        <button onClick={loadData} style={{ marginLeft: '10px' }}>🔄 Обновить</button>
      </div>

      {folders.map(folder => (
        <div key={folder.id} style={{ marginBottom: '20px', backgroundColor: '#2a2a4e', borderRadius: '8px', padding: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            {editingFolderId === folder.id ? (
              <>
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  style={{ padding: '4px', flex: 1 }}
                />
                <button onClick={() => handleRenameFolder(folder.id)}>Сохранить</button>
                <button onClick={() => { setEditingFolderId(null); setEditingName(''); }}>Отмена</button>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 'bold', fontSize: '18px' }}>📁 {folder.name}</span>
                <button onClick={() => { setEditingFolderId(folder.id); setEditingName(folder.name); }}>✏️</button>
                <button onClick={() => handleDeleteFolder(folder.id)} style={{ color: '#ff6b6b' }}>🗑️</button>
                <span style={{ marginLeft: 'auto', color: '#aaa' }}>({folder.students.length} учеников)</span>
              </>
            )}
          </div>

          <ul style={{ listStyle: 'none', padding: '0 0 0 20px' }}>
            {folder.students.map(studentId => {
              const student = students.find(s => s.id === studentId);
              if (!student) return null;
              return (
                <li key={student.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' }}>
                  <button onClick={() => onSelectStudent(student.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left', flex: 1 }}>
                    {student.name || `ID: ${student.id}`}
                  </button>
                  <select
                    value={folder.id}
                    onChange={(e) => handleMoveStudent(student.id, e.target.value === 'null' ? null : e.target.value)}
                    style={{ padding: '2px' }}
                  >
                    {folders.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                    <option value="null">Без папки</option>
                  </select>
                  <button onClick={() => handleDeleteStudent(student.id, student.name)} style={{ color: '#ff6b6b' }}>🗑️</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {studentsWithoutFolder.length > 0 && (
        <div style={{ marginBottom: '20px', backgroundColor: '#2a2a4e', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ margin: '0 0 8px 0' }}>📂 Без папки</h3>
          <ul style={{ listStyle: 'none', padding: '0 0 0 20px' }}>
            {studentsWithoutFolder.map(student => (
              <li key={student.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' }}>
                <button onClick={() => onSelectStudent(student.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left', flex: 1 }}>
                  {student.name || `ID: ${student.id}`}
                </button>
                <select
                  value="null"
                  onChange={(e) => handleMoveStudent(student.id, e.target.value === 'null' ? null : e.target.value)}
                  style={{ padding: '2px' }}
                >
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                  <option value="null">Без папки</option>
                </select>
                <button onClick={() => handleDeleteStudent(student.id, student.name)} style={{ color: '#ff6b6b' }}>🗑️</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {students.length === 0 && <p>Нет учеников. Попросите их открыть бота.</p>}
    </div>
  );
}

// ========== ФУНКЦИЯ ДЛЯ ИЗВЛЕЧЕНИЯ ID И ИМЕНИ ИЗ URL ==========
function extractUserInfoFromHash(): { id: string | null, firstName: string | null, lastName: string | null } {
  const hash = window.location.hash;
  if (!hash) return { id: null, firstName: null, lastName: null };
  
  const params = new URLSearchParams(hash.substring(1));
  const tgData = params.get('tgWebAppData');
  if (!tgData) return { id: null, firstName: null, lastName: null };
  
  const decoded = decodeURIComponent(tgData);
  const dataParams = new URLSearchParams(decoded);
  const userStr = dataParams.get('user');
  if (!userStr) return { id: null, firstName: null, lastName: null };
  
  try {
    const user = JSON.parse(userStr);
    return {
      id: user.id ? user.id.toString() : null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
    };
  } catch {
    return { id: null, firstName: null, lastName: null };
  }
}

// ========== ГЛАВНЫЙ КОМПОНЕНТ ==========
function App() {
  const [userId, setUserId] = useState('guest');
  const [userName, setUserName] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, boolean>>(() => loadProgress(userId));
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  useEffect(() => {
    const { id, firstName, lastName } = extractUserInfoFromHash();
    if (id) {
      setUserId(id);
      setProgress(loadProgress(id));
      let name = firstName || '';
      if (lastName) name += ' ' + lastName;
      const finalName = name.trim() || id;
      setUserName(finalName);
      saveUserName(id, finalName);
    } else {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        const user = tg.initDataUnsafe?.user;
        if (user?.id) {
          const id = user.id.toString();
          setUserId(id);
          setProgress(loadProgress(id));
          let name = user.first_name || '';
          if (user.last_name) name += ' ' + user.last_name;
          const finalName = name.trim() || id;
          setUserName(finalName);
          saveUserName(id, finalName);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (userId) {
      setProgress(loadProgress(userId));
      const savedName = loadUserName(userId);
      setUserName(savedName);
    }
  }, [userId]);

  const isAdmin = ADMIN_IDS.includes(Number(userId));

  if (isAdmin && selectedStudentId === null) {
    return (
      <TeacherDashboard
        onSelectStudent={(id) => {
          setSelectedStudentId(id);
          setUserId(id);
        }}
      />
    );
  }

  if (isAdmin && selectedStudentId !== null) {
    return (
      <div>
        <div style={{ padding: '10px', backgroundColor: '#333', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => setSelectedStudentId(null)}>⬅ Назад к списку</button>
          <span style={{ color: '#fff' }}>Редактирование: {userName || `ID: ${userId}`}</span>
        </div>
        <AdminPanel
          userId={userId}
          progress={progress}
          setProgress={setProgress}
          userName={userName}
        />
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
        <span style={{ color: '#fff' }}>Ученик: {userName || userId}</span>
      </div>
      <Tree
        data={buildTreeForDisplay(TREE_STRUCTURE, progress)}
        orientation="vertical"
        pathFunc="step"
        renderCustomNodeElement={renderCustomNode}
        translate={{ x: window.innerWidth / 2, y: 100 }}
        zoomable={true}
        draggable={true}
        separation={{ siblings: 1.5, nonSiblings: 1.5 }}
        nodeSize={{ x: 200, y: 100 }}
      />
    </div>
  );
}

export default App;