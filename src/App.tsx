import React, { useState, useEffect } from 'react';
import Tree from 'react-d3-tree';
import { supabase } from './supabaseClient';
import './App.css';

// ========== НАСТРОЙКА ==========
const ADMIN_IDS: number[] = [1394891154]; // замени на свои ID учителей

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

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С БАЗОЙ ==========
async function loadProgressFromDB(userId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('progress')
    .select('lesson_id, completed')
    .eq('user_id', Number(userId));

  if (error) {
    console.error('Ошибка загрузки прогресса:', error);
    return {};
  }

  const progress: Record<string, boolean> = {};
  data.forEach(row => {
    progress[row.lesson_id] = row.completed;
  });
  return progress;
}

async function saveProgressToDB(userId: string, progress: Record<string, boolean>) {
  const entries = Object.entries(progress).map(([lesson_id, completed]) => ({
    user_id: Number(userId),
    lesson_id,
    completed,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('progress')
    .upsert(entries, { onConflict: 'user_id, lesson_id' });

  if (error) {
    console.error('Ошибка сохранения прогресса:', error);
  }
}

async function loadUserNameFromDB(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('first_name, last_name')
    .eq('telegram_id', Number(userId))
    .single();

  if (error || !data) return null;
  return `${data.first_name || ''} ${data.last_name || ''}`.trim() || null;
}

async function saveUserToDB(userId: string, firstName: string, lastName: string | null, username: string | null) {
  const { error } = await supabase
    .from('users')
    .upsert({
      telegram_id: Number(userId),
      first_name: firstName,
      last_name: lastName,
      username: username,
    }, { onConflict: 'telegram_id' });

  if (error) {
    console.error('Ошибка сохранения пользователя:', error);
  }
}

async function getAllStudentsFromDB(teacherId: string): Promise<{ id: string; name: string | null }[]> {
  const { data: progressData, error: progressError } = await supabase
    .from('progress')
    .select('user_id');

  if (progressError || !progressData) return [];

  const userIds = progressData.map(p => p.user_id).filter(id => id !== Number(teacherId));
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from('users')
    .select('telegram_id, first_name, last_name')
    .in('telegram_id', userIds);

  if (error) return [];

  return data.map(u => ({
    id: u.telegram_id.toString(),
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || null,
  }));
}

// ========== РАБОТА С ПАПКАМИ ==========
async function getFoldersFromDB(teacherId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('id, name, folder_students(user_id)')
    .eq('teacher_id', Number(teacherId));

  if (error) return [];

  return data.map(f => ({
    id: f.id,
    name: f.name,
    students: f.folder_students?.map((fs: any) => fs.user_id.toString()) || [],
  }));
}

async function createFolderInDB(teacherId: string, name: string) {
  const { data, error } = await supabase
    .from('folders')
    .insert({ name, teacher_id: Number(teacherId) })
    .select('id')
    .single();

  if (error) return null;
  return data.id;
}

async function renameFolderInDB(folderId: string, newName: string) {
  await supabase.from('folders').update({ name: newName }).eq('id', folderId);
}

async function deleteFolderFromDB(folderId: string) {
  await supabase.from('folders').delete().eq('id', folderId);
}

async function moveStudentToFolderDB(studentId: string, folderId: string | null) {
  await supabase.from('folder_students').delete().eq('user_id', Number(studentId));
  if (folderId) {
    await supabase.from('folder_students').insert({ folder_id: folderId, user_id: Number(studentId) });
  }
}

async function deleteStudentFromDB(studentId: string) {
  await supabase.from('users').delete().eq('telegram_id', Number(studentId));
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function extractUserInfoFromHash(): { id: string | null, firstName: string | null, lastName: string | null, username: string | null } {
  const hash = window.location.hash;
  if (!hash) return { id: null, firstName: null, lastName: null, username: null };
  
  const params = new URLSearchParams(hash.substring(1));
  const tgData = params.get('tgWebAppData');
  if (!tgData) return { id: null, firstName: null, lastName: null, username: null };
  
  const decoded = decodeURIComponent(tgData);
  const dataParams = new URLSearchParams(decoded);
  const userStr = dataParams.get('user');
  if (!userStr) return { id: null, firstName: null, lastName: null, username: null };
  
  try {
    const user = JSON.parse(userStr);
    return {
      id: user.id ? user.id.toString() : null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      username: user.username || null,
    };
  } catch {
    return { id: null, firstName: null, lastName: null, username: null };
  }
}

// ========== КОМПОНЕНТЫ ==========
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

// Админка редактирования
function AdminPanel({ studentId, progress, setProgress, userName, onProgressChanged }: {
  studentId: string;
  progress: Record<string, boolean>;
  setProgress: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  userName: string | null;
  onProgressChanged: () => void;
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

  const handleToggle = async (lessonId: string) => {
    const newProgress = { ...progress, [lessonId]: !progress[lessonId] };
    setProgress(newProgress);
    await saveProgressToDB(studentId, newProgress);
    onProgressChanged();
  };

  const handleSelectAll = async (value: boolean) => {
    const newProgress: Record<string, boolean> = {};
    ALL_LESSON_IDS.forEach(id => { newProgress[id] = value; });
    setProgress(newProgress);
    await saveProgressToDB(studentId, newProgress);
    onProgressChanged();
  };

  const displayName = userName || `ID: ${studentId}`;

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

// Панель учителя
function TeacherDashboard({ onSelectStudent, teacherId }: {
  onSelectStudent: (userId: string) => void;
  teacherId: string;
}) {
  const [folders, setFolders] = useState<any[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string | null }[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const loadData = async () => {
    const folderData = await getFoldersFromDB(teacherId);
    setFolders(folderData);
    const studentData = await getAllStudentsFromDB(teacherId);
    setStudents(studentData);
  };

  useEffect(() => {
    loadData();
  }, [teacherId]);

  const handleCreateFolder = async () => {
    if (newFolderName.trim() === '') return;
    const id = await createFolderInDB(teacherId, newFolderName.trim());
    setNewFolderName('');
    if (id) await loadData();
  };

  const handleRenameFolder = async (folderId: string) => {
    if (editingName.trim() === '') return;
    await renameFolderInDB(folderId, editingName.trim());
    setEditingFolderId(null);
    setEditingName('');
    await loadData();
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Удалить папку?')) return;
    await deleteFolderFromDB(folderId);
    await loadData();
  };

  const handleMoveStudent = async (studentId: string, folderId: string | null) => {
    await moveStudentToFolderDB(studentId, folderId);
    await loadData();
  };

  const handleDeleteStudent = async (studentId: string, userName: string | null) => {
    if (!confirm(`Точно удалить ученика ${userName || studentId}?`)) return;
    await deleteStudentFromDB(studentId);
    await loadData();
  };

  const studentsWithoutFolder = students.filter(s => !folders.some(f => f.students.includes(s.id)));

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
            {folder.students.map((studentId: string) => {
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
    </div>
  );
}

// ========== ГЛАВНЫЙ КОМПОНЕНТ ==========
function App() {
  const [userId, setUserId] = useState('guest');
  const [userName, setUserName] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { id, firstName, lastName, username } = extractUserInfoFromHash();
      if (id) {
        // Устанавливаем ID в сессии Supabase (для RLS)
        await supabase.rpc('set_user_id', { user_id: Number(id) });
        setUserId(id);

        // Сохраняем пользователя
        await saveUserToDB(id, firstName || '', lastName || '', username || '');

        // Загружаем прогресс
        let prog = await loadProgressFromDB(id);
        if (Object.keys(prog).length === 0) {
          console.log('🔄 Прогресс пуст, создаём записи для ученика', id);
          const initialProgress: Record<string, boolean> = {};
          ALL_LESSON_IDS.forEach(lessonId => { initialProgress[lessonId] = false; });
          await saveProgressToDB(id, initialProgress);
          prog = initialProgress;
        }
        setProgress(prog);
        const name = await loadUserNameFromDB(id);
        setUserName(name || `${firstName || ''} ${lastName || ''}`.trim() || id);
      } else {
        // fallback через Telegram WebApp
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
          tg.ready();
          const user = tg.initDataUnsafe?.user;
          if (user?.id) {
            const id = user.id.toString();
            await supabase.rpc('set_user_id', { user_id: Number(id) });
            setUserId(id);
            await saveUserToDB(id, user.first_name || '', user.last_name || '', user.username || '');
            let prog = await loadProgressFromDB(id);
            if (Object.keys(prog).length === 0) {
              const initialProgress: Record<string, boolean> = {};
              ALL_LESSON_IDS.forEach(lessonId => { initialProgress[lessonId] = false; });
              await saveProgressToDB(id, initialProgress);
              prog = initialProgress;
            }
            setProgress(prog);
            const name = await loadUserNameFromDB(id);
            setUserName(name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || id);
          }
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  // При выборе ученика (из панели учителя) загружаем его прогресс
  useEffect(() => {
    if (selectedStudentId) {
      const loadStudentData = async () => {
        const prog = await loadProgressFromDB(selectedStudentId);
        setProgress(prog);
        const name = await loadUserNameFromDB(selectedStudentId);
        setUserName(name);
      };
      loadStudentData();
    }
  }, [selectedStudentId]);

  const isAdmin = ADMIN_IDS.includes(Number(userId));

  if (loading) {
    return <div style={{ color: '#fff', padding: '20px' }}>Загрузка...</div>;
  }

  // Если учитель и не выбран ученик – показываем панель управления
  if (isAdmin && selectedStudentId === null) {
    return <TeacherDashboard teacherId={userId} onSelectStudent={(id) => {
      setSelectedStudentId(id);
    }} />;
  }

  // Если учитель и выбран ученик – показываем админку редактирования
  if (isAdmin && selectedStudentId !== null) {
    return (
      <div>
        <div style={{ padding: '10px', backgroundColor: '#333', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => {
            setSelectedStudentId(null);
            setUserName('');
          }}>⬅ Назад к списку</button>
          <span style={{ color: '#fff' }}>Редактирование: {userName || `ID: ${selectedStudentId}`}</span>
        </div>
        <AdminPanel
          studentId={selectedStudentId}
          progress={progress}
          setProgress={setProgress}
          userName={userName}
          onProgressChanged={async () => {
            const prog = await loadProgressFromDB(selectedStudentId);
            setProgress(prog);
          }}
        />
      </div>
    );
  }

  // Режим ученика (или учитель, который не админ)
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