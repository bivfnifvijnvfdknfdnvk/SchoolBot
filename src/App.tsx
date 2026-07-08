import React, { useState, useEffect } from 'react';
import Tree from 'react-d3-tree';
import './App.css';

// ========== НАСТРОЙКА ==========
// Список Telegram ID учителей (замените на свои)
const ADMIN_IDS: number[] = [
  1394891154, // сюда вставьте свой ID (и ID других учителей)
  // можно добавить ещё через запятую
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

// Получить список всех учеников (ID и имена) из localStorage
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

// ========== ПОСТРОЕНИЕ ДЕРЕВА ДЛЯ ВИЗУАЛИЗАЦИИ ==========
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
function TeacherDashboard({ onSelectStudent }: { onSelectStudent: (userId: string) => void }) {
  const [students, setStudents] = useState<{ id: string; name: string | null }[]>([]);

  // Обновляем список учеников при каждом рендере (или можно через useEffect)
  useEffect(() => {
    setStudents(getAllStudents());
  }, []);

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
      <h2>👨‍🏫 Панель учителя</h2>
      <p>Выберите ученика для редактирования:</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {students.length === 0 && <li>Нет учеников. Попросите их открыть бота.</li>}
        {students.map(student => (
          <li key={student.id} style={{ margin: '8px 0' }}>
            <button
              onClick={() => onSelectStudent(student.id)}
              style={{
                padding: '10px 15px',
                backgroundColor: '#333',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left'
              }}
            >
              {student.name || `ID: ${student.id}`}
            </button>
          </li>
        ))}
      </ul>
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
  // Состояние для учителя: выбранный ученик (если null — показываем список)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Получаем данные пользователя при загрузке
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
      // Запасной вариант через Telegram WebApp
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

  // При смене ID (например, учитель выбрал ученика) обновляем прогресс и имя
  useEffect(() => {
    if (userId) {
      setProgress(loadProgress(userId));
      const savedName = loadUserName(userId);
      setUserName(savedName);
    }
  }, [userId]);

  // Проверяем, является ли текущий пользователь учителем
  const isAdmin = ADMIN_IDS.includes(Number(userId));

  // Если учитель и не выбран конкретный ученик — показываем панель управления
  if (isAdmin && selectedStudentId === null) {
    return (
      <TeacherDashboard
        onSelectStudent={(id) => {
          setSelectedStudentId(id);
          setUserId(id); // загружаем данные выбранного ученика
        }}
      />
    );
  }

  // Если учитель и выбран ученик — показываем админку для редактирования
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

  // ========== РЕЖИМ УЧЕНИКА ==========
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