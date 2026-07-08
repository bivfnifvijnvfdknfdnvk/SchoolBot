import React, { useState, useEffect } from 'react';
import Tree from 'react-d3-tree';
import './App.css';

// ========== 1. СТАТИЧЕСКАЯ СТРУКТУРА ДЕРЕВА ==========
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

// ========== 2. РАБОТА С ПРОГРЕССОМ ==========
function getProgressKey(userId: string) {
  return `progress_${userId}`;
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

// ========== 3. ПОСТРОЕНИЕ ДЕРЕВА ДЛЯ ВИЗУАЛИЗАЦИИ ==========
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

// ========== 4. КОМПОНЕНТ ДЛЯ ОТОБРАЖЕНИЯ УЗЛА ==========
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

// ========== 5. АДМИНКА ==========
function AdminPanel({ userId, progress, setProgress }: {
  userId: string;
  progress: Record<string, boolean>;
  setProgress: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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

  return (
    <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
      <h2>Админ-панель для ученика {userId}</h2>
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

// ========== 6. ГЛАВНЫЙ КОМПОНЕНТ ==========
function App() {
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [userId, setUserId] = useState('guest');
  const [progress, setProgress] = useState<Record<string, boolean>>(() => loadProgress(userId));

  useEffect(() => {
    // Пытаемся извлечь ID из URL (Telegram передаёт его в hash)
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1)); // убираем #
      const userData = params.get('tgWebAppData');
      if (userData) {
        try {
          // Ищем часть "user": {"id":12345,...}
          const userMatch = userData.match(/user%3D%7B(.*?)%7D/);
          if (userMatch) {
            const userJson = decodeURIComponent(userMatch[1]);
            const user = JSON.parse('{' + userJson + '}');
            if (user.id) {
              const id = user.id.toString();
              setUserId(id);
              setProgress(loadProgress(id));
              return;
            }
          }
        } catch (e) {
          console.warn('Не удалось распарсить user из URL', e);
        }
      }
    }

    // Запасной вариант: пробуем через Telegram WebApp (если вдруг загрузится)
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      const id = tg.initDataUnsafe?.user?.id?.toString();
      if (id) {
        setUserId(id);
        setProgress(loadProgress(id));
      }
    }
  }, []);

  useEffect(() => {
    setProgress(loadProgress(userId));
  }, [userId]);

  const treeData = buildTreeForDisplay(TREE_STRUCTURE, progress);

  if (mode === 'teacher') {
    return (
      <div>
        <div style={{ padding: '10px', backgroundColor: '#333', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => setMode('student')}>Режим ученика</button>
          <span style={{ color: '#fff' }}>ID ученика: </span>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ padding: '5px' }}
          />
        </div>
        <AdminPanel userId={userId} progress={progress} setProgress={setProgress} />
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
        <button onClick={() => setMode('teacher')}>Вход для учителя</button>
        <span style={{ color: '#fff', marginLeft: '10px' }}>Ученик: {userId}</span>
      </div>
      <Tree
        data={treeData}
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