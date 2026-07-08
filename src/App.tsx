import { useState, useEffect } from 'react';
import Tree from 'react-d3-tree';
import { supabase } from './supabaseClient';
import JSZip from 'jszip';
import './App.css';

// ========== НАСТРОЙКА ==========
const ADMIN_IDS: number[] = [1394891154]; // ID учителей

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

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С БАЗОЙ ==========
// (они остаются такими же, как в предыдущей версии)

async function getTeacherPrograms(teacherId: string) {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('teacher_id', Number(teacherId));
  if (error) {
    console.error('Ошибка загрузки программ учителя:', error);
    return [];
  }
  return data || [];
}

async function getAllPrograms() {
  const { data, error } = await supabase
    .from('programs')
    .select('*');
  if (error) {
    console.error('Ошибка загрузки всех программ:', error);
    return [];
  }
  return data || [];
}

async function createProgram(name: string, teacherId: string, structure: any) {
  const { data, error } = await supabase
    .from('programs')
    .insert({
      name,
      teacher_id: Number(teacherId),
      structure,
    })
    .select('id')
    .single();
  if (error) {
    console.error('Ошибка создания программы:', error);
    return null;
  }
  return data.id;
}

async function getApplicationsForProgram(programId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('program_id', programId);
  if (error) {
    console.error('Ошибка загрузки заявок:', error);
    return [];
  }
  return data || [];
}

async function createApplication(programId: string, studentId: string) {
  const { error } = await supabase
    .from('applications')
    .insert({
      program_id: programId,
      student_id: Number(studentId),
      status: 'pending',
    });
  if (error) {
    console.error('Ошибка создания заявки:', error);
    return false;
  }
  return true;
}

async function updateApplicationStatus(applicationId: string, status: string) {
  const { error } = await supabase
    .from('applications')
    .update({ status })
    .eq('id', applicationId);
  if (error) {
    console.error('Ошибка обновления заявки:', error);
    return false;
  }
  return true;
}

async function getAcceptedStudents(programId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select('student_id')
    .eq('program_id', programId)
    .eq('status', 'accepted');
  if (error || !data) return [];
  const studentIds = data.map(item => item.student_id);
  if (studentIds.length === 0) return [];

  const { data: users, error: userError } = await supabase
    .from('users')
    .select('telegram_id, first_name, last_name')
    .in('telegram_id', studentIds);
  if (userError) return [];
  return users.map(u => ({
    id: u.telegram_id.toString(),
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || null,
  }));
}

async function loadProgressForProgram(userId: string, programId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('progress')
    .select('lesson_id, completed')
    .eq('user_id', Number(userId))
    .eq('program_id', programId);
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

// Функция для сохранения прогресса (пока не используется, но оставлена на будущее)
// async function saveProgressForProgram(userId: string, programId: string, progress: Record<string, boolean>) {
//   ...
// }

async function getStudentPrograms(studentId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select('program_id')
    .eq('student_id', Number(studentId))
    .eq('status', 'accepted');
  if (error || !data) return [];
  const programIds = data.map(item => item.program_id);
  if (programIds.length === 0) return [];
  const { data: programs, error: progError } = await supabase
    .from('programs')
    .select('*')
    .in('id', programIds);
  if (progError) return [];
  return programs || [];
}

async function getApplicationStatus(studentId: string, programId: string) {
  const { data, error } = await supabase
    .from('applications')
    .select('status, id')
    .eq('student_id', Number(studentId))
    .eq('program_id', programId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// ========== ФУНКЦИЯ ПОСТРОЕНИЯ ДЕРЕВА ИЗ ZIP ==========
function buildTreeFromZip(zip: JSZip): { name: string; structure: any } {
  // Корневая папка ZIP может называться как угодно, возьмём имя первой папки
  const rootFolderName = Object.keys(zip.files).find(path => path.includes('/'))?.split('/')[0] || 'Программа';
  
  // Строим дерево рекурсивно
  function buildNode(path: string, zip: JSZip): any {
    const parts = path.split('/').filter(p => p);
    if (parts.length === 0) return null;
    const currentName = parts[0];
    const rest = parts.slice(1);
    // Проверяем, есть ли вложенные папки или файлы
    const children: any[] = [];
    // Получаем все записи в текущей папке
    const prefix = path + (path.endsWith('/') ? '' : '/');
    const entries = Object.keys(zip.files).filter(key => key.startsWith(prefix) && key !== prefix);
    // Группируем по первому элементу после префикса
    const subPaths = new Set<string>();
    entries.forEach(key => {
      const relative = key.replace(prefix, '');
      const firstPart = relative.split('/')[0];
      if (firstPart) subPaths.add(firstPart);
    });
    // Для каждого элемента строим узел
    subPaths.forEach(sub => {
      const fullPath = prefix + sub;
      const item = zip.files[fullPath];
      if (item && !item.dir) {
        // это файл -> урок
        const nameWithoutExt = sub.replace(/\.[^/.]+$/, '');
        children.push({ id: nameWithoutExt, name: nameWithoutExt });
      } else if (item && item.dir) {
        // это папка -> категория
        const childNode = buildNode(fullPath, zip);
        if (childNode) children.push(childNode);
      } else {
        // возможно, это файл внутри подпапки, но мы уже обработаем рекурсивно
        const childNode = buildNode(fullPath, zip);
        if (childNode) children.push(childNode);
      }
    });
    // Если это корень, возвращаем объект с именем программы и детьми
    if (path === '') {
      const rootChildren = [];
      // все первые папки/файлы в корне
      const rootEntries = Object.keys(zip.files)
        .filter(key => !key.includes('/') && !key.endsWith('/'))
        .map(key => ({ name: key, isFile: true }));
      // обрабатываем корневые файлы
      rootEntries.forEach(file => {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        rootChildren.push({ id: nameWithoutExt, name: nameWithoutExt });
      });
      // обрабатываем корневые папки
      const folders = new Set<string>();
      Object.keys(zip.files).forEach(key => {
        if (key.includes('/')) {
          const first = key.split('/')[0];
          if (first) folders.add(first);
        }
      });
      folders.forEach(folder => {
        const child = buildNode(folder, zip);
        if (child) rootChildren.push(child);
      });
      return { name: rootFolderName, structure: { id: 'root', name: rootFolderName, children: rootChildren } };
    } else {
      // это папка: создаём узел с именем и дочерними элементами
      // Имя папки - последний элемент пути
      const folderName = parts[parts.length - 1];
      return { id: folderName, name: folderName, children: children };
    }
  }

  const tree = buildNode('', zip);
  return { name: rootFolderName, structure: tree.structure };
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
    const lessonIds = getAllLessonIds(node);
    const total = lessonIds.length;
    let completedCount = 0;
    lessonIds.forEach(id => {
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

function getAllLessonIds(node: any): string[] {
  if (!node.children) return [node.id];
  let result: string[] = [];
  node.children.forEach((child: any) => {
    result = result.concat(getAllLessonIds(child));
  });
  return result;
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

function SkillTreeView({ structure, progress }: { structure: any; progress: Record<string, boolean> }) {
  const treeData = buildTreeForDisplay(structure, progress);
  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
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

function StudentProgramList({ userId, onApply, existingProgramIds }: { userId: string; onApply: (programId: string) => void; existingProgramIds: string[] }) {
  const [availablePrograms, setAvailablePrograms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const all = await getAllPrograms();
      const filtered = [];
      for (const prog of all) {
        if (existingProgramIds.includes(prog.id)) continue;
        const status = await getApplicationStatus(userId, prog.id);
        if (status && (status.status === 'pending' || status.status === 'rejected')) {
          filtered.push({ ...prog, appStatus: status.status, appId: status.id });
        } else if (!status) {
          filtered.push({ ...prog, appStatus: null });
        }
      }
      setAvailablePrograms(filtered);
      setLoading(false);
    };
    load();
  }, [userId, existingProgramIds]);

  if (loading) return <p>Загрузка...</p>;

  if (availablePrograms.length === 0) {
    return <p>Нет доступных программ для подачи заявки.</p>;
  }

  return (
    <div>
      {availablePrograms.map(prog => (
        <div key={prog.id} style={{ margin: '10px 0', backgroundColor: '#333', padding: '15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{prog.name}</span>
          {prog.appStatus === 'pending' && <span style={{ color: '#ffa500' }}>⏳ Заявка отправлена</span>}
          {prog.appStatus === 'rejected' && <span style={{ color: '#ff4444' }}>❌ Отклонена</span>}
          {!prog.appStatus && <button onClick={() => onApply(prog.id)}>📩 Подать заявку</button>}
          {prog.appStatus === 'pending' && <span>ожидайте</span>}
          {prog.appStatus === 'rejected' && <button onClick={() => onApply(prog.id)}>📩 Подать заново</button>}
        </div>
      ))}
    </div>
  );
}

// ========== ОСНОВНОЙ КОМПОНЕНТ ==========
function App() {
  const [userId, setUserId] = useState('guest');
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [programs, setPrograms] = useState<any[]>([]);
  const [currentProgramId, setCurrentProgramId] = useState<string | null>(null);
  const [view, setView] = useState<'programs' | 'create' | 'tree' | 'admin'>('programs');

  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [structure, setStructure] = useState<any>(null);

  const [applications, setApplications] = useState<any[]>([]);
  const [acceptedStudents, setAcceptedStudents] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const [newProgramName, setNewProgramName] = useState('');
  const [newProgramZip, setNewProgramZip] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Загрузка данных пользователя
  useEffect(() => {
    const init = async () => {
      const { id, firstName, lastName, username } = extractUserInfoFromHash();
      if (id) {
        setUserId(id);
        const admin = ADMIN_IDS.includes(Number(id));
        setIsAdmin(admin);
        await supabase
          .from('users')
          .upsert({
            telegram_id: Number(id),
            first_name: firstName || '',
            last_name: lastName || '',
            username: username || '',
          }, { onConflict: 'telegram_id' });
        setUserName(`${firstName || ''} ${lastName || ''}`.trim() || id);
      } else {
        const tg = (window as any).Telegram?.WebApp;
        if (tg) {
          tg.ready();
          const user = tg.initDataUnsafe?.user;
          if (user?.id) {
            const id = user.id.toString();
            setUserId(id);
            const admin = ADMIN_IDS.includes(Number(id));
            setIsAdmin(admin);
            await supabase
              .from('users')
              .upsert({
                telegram_id: Number(id),
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                username: user.username || '',
              }, { onConflict: 'telegram_id' });
            setUserName(`${user.first_name || ''} ${user.last_name || ''}`.trim() || id);
          }
        }
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (userId === 'guest') return;
    loadPrograms();
  }, [userId, isAdmin]);

  const loadPrograms = async () => {
    if (isAdmin) {
      const progs = await getTeacherPrograms(userId);
      setPrograms(progs);
    } else {
      const progs = await getStudentPrograms(userId);
      setPrograms(progs);
    }
    setView('programs');
    setCurrentProgramId(null);
  };

  const selectProgram = async (programId: string) => {
    setCurrentProgramId(programId);
    const prog = programs.find(p => p.id === programId);
    if (prog) {
      setStructure(prog.structure);
      const progData = await loadProgressForProgram(userId, programId);
      setProgress(progData);
    }
    if (isAdmin) {
      const apps = await getApplicationsForProgram(programId);
      setApplications(apps);
      const accepted = await getAcceptedStudents(programId);
      setAcceptedStudents(accepted);
      setView('admin');
      setSelectedStudentId(null);
    } else {
      setView('tree');
    }
  };

  // Функция для создания программы из ZIP
  const handleCreateProgramFromZip = async () => {
    if (!newProgramName.trim()) {
      alert('Введите название программы');
      return;
    }
    if (!newProgramZip) {
      alert('Выберите ZIP-архив');
      return;
    }
    setUploading(true);
    try {
      const zip = await JSZip.loadAsync(await newProgramZip.arrayBuffer());
      const { name, structure } = buildTreeFromZip(zip);
      // Если имя программы не задано явно, берём из ZIP
      const programName = newProgramName.trim() || name;
      const id = await createProgram(programName, userId, structure);
      if (id) {
        alert('Программа успешно создана!');
        setView('programs');
        setNewProgramName('');
        setNewProgramZip(null);
        loadPrograms();
      } else {
        alert('Ошибка создания программы');
      }
    } catch (error) {
      console.error(error);
      alert('Ошибка при распаковке ZIP. Убедитесь, что файл корректен.');
    }
    setUploading(false);
  };

  const handleAcceptApplication = async (appId: string) => {
    await updateApplicationStatus(appId, 'accepted');
    const apps = await getApplicationsForProgram(currentProgramId!);
    setApplications(apps);
    const accepted = await getAcceptedStudents(currentProgramId!);
    setAcceptedStudents(accepted);
  };

  const handleRejectApplication = async (appId: string) => {
    await updateApplicationStatus(appId, 'rejected');
    const apps = await getApplicationsForProgram(currentProgramId!);
    setApplications(apps);
  };

  const handleApply = async (programId: string) => {
    const success = await createApplication(programId, userId);
    if (success) {
      alert('Заявка отправлена!');
      loadPrograms();
    } else {
      alert('Ошибка отправки заявки');
    }
  };

  const handleSelectStudent = async (studentId: string) => {
    setSelectedStudentId(studentId);
    const prog = await loadProgressForProgram(studentId, currentProgramId!);
    setProgress(prog);
    setView('tree');
  };

  const backToAdmin = () => {
    setSelectedStudentId(null);
    setView('admin');
    loadProgressForProgram(userId, currentProgramId!).then(p => setProgress(p));
  };

  // ========== ОТРИСОВКА ==========

  if (userId === 'guest') {
    return <div style={{ color: '#fff', padding: '20px' }}>Загрузка...</div>;
  }

  if (isAdmin && view === 'create') {
    return (
      <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
        <button onClick={() => setView('programs')}>⬅ Назад</button>
        <h2>Создать программу из ZIP</h2>
        <div>
          <label>Название программы (опционально, если не указано, будет взято из имени ZIP):</label><br />
          <input
            type="text"
            value={newProgramName}
            onChange={(e) => setNewProgramName(e.target.value)}
            placeholder="Введите название"
            style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
          />
        </div>
        <div>
          <label>Выберите ZIP-архив с папками и файлами:</label><br />
          <input
            type="file"
            accept=".zip"
            onChange={(e) => setNewProgramZip(e.target.files ? e.target.files[0] : null)}
            style={{ marginBottom: '10px' }}
          />
        </div>
        <div>
          <button onClick={handleCreateProgramFromZip} disabled={uploading}>
            {uploading ? 'Загрузка...' : 'Создать программу'}
          </button>
        </div>
        <div style={{ marginTop: '20px', color: '#aaa' }}>
          <p>Инструкция: создайте ZIP-архив, внутри которого папки с названиями категорий (например, "Лексика"), внутри каждой папки — файлы-уроки (можно .txt). Структура будет автоматически преобразована в дерево навыков.</p>
        </div>
      </div>
    );
  }

  if (isAdmin && view === 'admin' && currentProgramId) {
    if (selectedStudentId) {
      return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: '10px' }}>
            <button onClick={backToAdmin}>⬅ Назад к админке</button>
            <span style={{ color: '#fff' }}>Редактирование ученика: {selectedStudentId}</span>
          </div>
          <SkillTreeView structure={structure} progress={progress} />
        </div>
      );
    }

    return (
      <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
        <button onClick={() => { setView('programs'); setCurrentProgramId(null); }}>⬅ Назад к программам</button>
        <h2>Панель управления программой</h2>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3>Дерево навыков (превью)</h3>
            <div style={{ height: '400px', overflow: 'auto', border: '1px solid #555', borderRadius: '8px', padding: '10px' }}>
              <SkillTreeView structure={structure} progress={progress} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3>Заявки на вступление</h3>
            {applications.filter(a => a.status === 'pending').map(app => (
              <div key={app.id} style={{ marginBottom: '10px', backgroundColor: '#333', padding: '10px', borderRadius: '8px' }}>
                <span>Ученик ID: {app.student_id}</span>
                <div>
                  <button onClick={() => handleAcceptApplication(app.id)} style={{ marginRight: '10px', backgroundColor: '#4CAF50' }}>✅ Принять</button>
                  <button onClick={() => handleRejectApplication(app.id)} style={{ backgroundColor: '#f44336' }}>❌ Отклонить</button>
                </div>
              </div>
            ))}
            {applications.filter(a => a.status === 'pending').length === 0 && <p>Нет новых заявок</p>}

            <h3>Принятые ученики</h3>
            {acceptedStudents.map(student => (
              <div key={student.id} style={{ marginBottom: '10px', backgroundColor: '#333', padding: '10px', borderRadius: '8px' }}>
                <span>{student.name || `ID: ${student.id}`}</span>
                <button onClick={() => handleSelectStudent(student.id)} style={{ marginLeft: '10px' }}>📝 Редактировать</button>
              </div>
            ))}
            {acceptedStudents.length === 0 && <p>Нет принятых учеников</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin && view === 'tree' && currentProgramId) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => { setView('programs'); setCurrentProgramId(null); }}>⬅ Сменить программу</button>
          <span style={{ color: '#fff' }}>Программа: {programs.find(p => p.id === currentProgramId)?.name || ''}</span>
          <span style={{ color: '#fff' }}>Ученик: {userName || userId}</span>
        </div>
        <SkillTreeView structure={structure} progress={progress} />
      </div>
    );
  }

  if (view === 'programs') {
    if (isAdmin) {
      return (
        <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
          <h2>Мои программы</h2>
          <button onClick={() => setView('create')}>➕ Создать программу (ZIP)</button>
          {programs.length === 0 && <p>У вас пока нет программ. Создайте первую!</p>}
          {programs.map(prog => (
            <div key={prog.id} style={{ margin: '10px 0', backgroundColor: '#333', padding: '15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{prog.name}</span>
              <button onClick={() => selectProgram(prog.id)}>Открыть</button>
            </div>
          ))}
        </div>
      );
    } else {
      return (
        <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
          <h2>Мои программы</h2>
          {programs.length === 0 && <p>Вы ещё не приняты ни в одну программу. Подайте заявку ниже.</p>}
          {programs.map(prog => (
            <div key={prog.id} style={{ margin: '10px 0', backgroundColor: '#333', padding: '15px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{prog.name}</span>
              <button onClick={() => selectProgram(prog.id)}>Открыть</button>
            </div>
          ))}

          <hr style={{ margin: '30px 0' }} />
          <h3>Доступные программы</h3>
          <StudentProgramList userId={userId} onApply={handleApply} existingProgramIds={programs.map(p => p.id)} />
        </div>
      );
    }
  }

  return <div style={{ color: '#fff', padding: '20px' }}>Неизвестный экран</div>;
}

export default App;