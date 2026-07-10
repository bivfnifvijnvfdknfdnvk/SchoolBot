import { useState, useEffect, useRef } from 'react';
import Tree from 'react-d3-tree';
import { supabase } from './supabaseClient';
import './App.css';

// ========== КОНСТАНТЫ ==========
const STORAGE_URL = 'https://wmfjjpsakhmwwyvimqwx.supabase.co/storage/v1/object/public/icons/';
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

async function getVisiblePrograms() {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('visible', true);
  if (error) {
    console.error('Ошибка загрузки видимых программ:', error);
    return [];
  }
  return data || [];
}

async function getUsersByIds(userIds: number[]): Promise<Record<number, string>> {
  if (userIds.length === 0) return {};
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id, first_name, last_name')
    .in('telegram_id', userIds);
  if (error) {
    console.error('Ошибка загрузки имён пользователей:', error);
    return {};
  }
  const result: Record<number, string> = {};
  data.forEach(u => {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.telegram_id.toString();
    result[u.telegram_id] = name;
  });
  return result;
}

async function createProgram(name: string, teacherId: string, structure: any) {
  const { data, error } = await supabase
    .from('programs')
    .insert({
      name,
      teacher_id: Number(teacherId),
      created_by: Number(teacherId),
      visible: false,
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

async function updateProgram(programId: string, updates: { name?: string; structure?: any; visible?: boolean }) {
  const { error } = await supabase
    .from('programs')
    .update(updates)
    .eq('id', programId);
  if (error) {
    console.error('Ошибка обновления программы:', error);
    return false;
  }
  return true;
}

async function toggleProgramVisibility(programId: string, currentVisible: boolean) {
  return updateProgram(programId, { visible: !currentVisible });
}

async function deleteProgram(programId: string) {
  const { error } = await supabase
    .from('programs')
    .delete()
    .eq('id', programId);
  if (error) {
    console.error('Ошибка удаления программы:', error);
    return false;
  }
  return true;
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
  const studentIds = data.map(app => app.student_id);
  if (studentIds.length === 0) return data;
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('telegram_id, first_name, last_name')
    .in('telegram_id', studentIds);
  if (userError) return data;
  const userMap: { [key: number]: string } = {};
  users.forEach(u => {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.telegram_id.toString();
    userMap[u.telegram_id] = name;
  });
  return data.map(app => ({
    ...app,
    student_name: userMap[app.student_id] || app.student_id.toString(),
  }));
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
    name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.telegram_id.toString(),
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

async function saveProgressForProgram(userId: string, programId: string, progress: Record<string, boolean>) {
  const entries = Object.entries(progress).map(([lesson_id, completed]) => ({
    user_id: Number(userId),
    program_id: programId,
    lesson_id,
    completed,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('progress')
    .upsert(entries, { onConflict: 'user_id, program_id, lesson_id' });
  if (error) {
    console.error('Ошибка сохранения прогресса:', error);
  }
}

async function getStudentPrograms(studentId: string) {
  const { data: applications, error: appError } = await supabase
    .from('applications')
    .select('program_id')
    .eq('student_id', Number(studentId))
    .eq('status', 'accepted');
  if (appError || !applications) return [];
  const programIds = applications.map(item => item.program_id);
  if (programIds.length === 0) return [];
  const { data: programs, error: progError } = await supabase
    .from('programs')
    .select('*')
    .in('id', programIds)
    .eq('visible', true);
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

// ========== КОМПОНЕНТЫ ДЛЯ РЕДАКТОРА ==========

function updateNodeInTree(tree: any, id: string, updates: any): any {
  if (tree.id === id) {
    return { ...tree, ...updates };
  }
  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child: any) => updateNodeInTree(child, id, updates)),
    };
  }
  return tree;
}

function deleteNodeFromTree(tree: any, id: string): any {
  if (tree.children) {
    const filtered = tree.children.filter((child: any) => child.id !== id);
    return {
      ...tree,
      children: filtered.map((child: any) => deleteNodeFromTree(child, id)),
    };
  }
  return tree;
}

function findNode(node: any, id: string): any {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findNodeAndAddChild(tree: any, parentId: string): { newTree: any; newId: string } {
  function traverse(node: any): { found: boolean; newNode: any; newId: string } {
    if (node.id === parentId) {
      const newId = Date.now().toString() + Math.random().toString(36).substring(2, 6);
      const newChild = {
        id: newId,
        name: 'Новый узел',
        children: [],
        isLesson: false,
        imageKey: null,
        prerequisites: [],
        textClosed: '',
        textOpen: '',
        textCompleted: '',
      };
      const newChildren = node.children ? [...node.children, newChild] : [newChild];
      return { found: true, newNode: { ...node, children: newChildren }, newId };
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const result = traverse(node.children[i]);
        if (result.found) {
          const newChildren = [...node.children];
          newChildren[i] = result.newNode;
          return { found: true, newNode: { ...node, children: newChildren }, newId: result.newId };
        }
      }
    }
    return { found: false, newNode: node, newId: '' };
  }
  const result = traverse(tree);
  return { newTree: result.newNode, newId: result.newId };
}

// Рендер узла для редактора (в обычном режиме)
const renderEditorNode = ({ nodeDatum, onNodeClick, isSelectMode, onSelectToggle }: any) => {
  const isLesson = nodeDatum.isLesson || false;
  const imageUrl = nodeDatum.imageKey ? `${STORAGE_URL}${nodeDatum.imageKey}` : null;
  const radius = 24;

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (isSelectMode && isLesson && onSelectToggle) {
      onSelectToggle(nodeDatum.id);
      return;
    }
    if (onNodeClick) {
      onNodeClick(nodeDatum.id);
    }
  };

  const clipId = `clip-${nodeDatum.id || Math.random().toString(36).substring(2, 10)}`;
  const isSelected = nodeDatum._selected || false;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <circle cx="0" cy="0" r={radius} />
        </clipPath>
      </defs>

      {imageUrl ? (
        <image
          href={imageUrl}
          x="-24" y="-24"
          width="48" height="48"
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
          onClick={handleClick}
          style={{ cursor: isSelectMode && isLesson ? 'pointer' : 'pointer', transform: 'scaleY(-1)', outline: isSelected ? '2px solid #4CAF50' : 'none' }}
        />
      ) : (
        <circle
          r={radius}
          fill={isLesson ? (isSelected ? '#4CAF50' : '#FF9800') : '#2196F3'}
          stroke={isSelected ? '#4CAF50' : 'none'}
          strokeWidth={isSelected ? 4 : 0}
          onClick={handleClick}
          style={{ cursor: isSelectMode && isLesson ? 'pointer' : 'pointer' }}
        />
      )}

      <circle cx="0" cy="0" r={radius} fill="none" stroke="#fff" strokeWidth="2" onClick={handleClick} style={{ pointerEvents: 'none' }} />

      <text
        fill="#fff"
        stroke="none"
        strokeWidth="0"
        x={radius + 10}
        y="4"
        fontSize={14}
        fontFamily="Arial, sans-serif"
        textAnchor="start"
        style={{ fontWeight: 'normal', transform: 'scaleY(-1)' }}
        onClick={handleClick}
      >
        {nodeDatum.name}
        {isSelectMode && isLesson && (isSelected ? ' ✅' : ' ⬜')}
      </text>
    </g>
  );
};

function buildEditorTree(node: any, selectedIds?: string[]): any {
  return {
    name: node.name,
    id: node.id,
    isLesson: node.isLesson || false,
    imageKey: node.imageKey || null,
    prerequisites: node.prerequisites || [],
    textClosed: node.textClosed || '',
    textOpen: node.textOpen || '',
    textCompleted: node.textCompleted || '',
    _selected: selectedIds ? selectedIds.includes(node.id) : false,
    children: node.children ? node.children.map((child: any) => buildEditorTree(child, selectedIds)) : undefined,
  };
}

// Компонент дерева для редактора (ветви вверх)
function EditableTreeView({ structure, onNodeClick, isSelectMode, onSelectToggle, selectedIds }: {
  structure: any;
  onNodeClick: (nodeId: string) => void;
  isSelectMode?: boolean;
  onSelectToggle?: (nodeId: string) => void;
  selectedIds?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [translate, setTranslate] = useState({ x: 400, y: 100 });

  useEffect(() => {
    const updateTranslate = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        setTranslate({ x: width / 2, y: height - 150 });
      }
    };
    updateTranslate();
    window.addEventListener('resize', updateTranslate);
    return () => window.removeEventListener('resize', updateTranslate);
  }, []);

  const treeData = buildEditorTree(structure, selectedIds);
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', backgroundColor: '#1a1a2e', transform: 'scaleY(-1)' }}>
      <Tree
        data={treeData}
        orientation="vertical"
        pathFunc="step"
        renderCustomNodeElement={(props) => renderEditorNode({ ...props, onNodeClick, isSelectMode, onSelectToggle })}
        translate={translate}
        zoomable={true}
        draggable={true}
        separation={{ siblings: 1.5, nonSiblings: 1.5 }}
        nodeSize={{ x: 200, y: 100 }}
        collapsible={false}
      />
    </div>
  );
}

// ========== ВИЗУАЛЬНЫЙ РЕДАКТОР ПРОГРАММ ==========
function ProgramEditor({ initialStructure, initialName, onSave, onCancel }: {
  initialStructure?: any;
  initialName?: string;
  onSave: (name: string, structure: any) => void;
  onCancel: () => void;
}) {
  const [tree, setTree] = useState<any>(() => {
    if (initialStructure) {
      return initialStructure;
    }
    return {
      id: 'root',
      name: 'Корневой узел',
      children: [],
      isLesson: false,
      imageKey: null,
    };
  });

  const [programName, setProgramName] = useState(initialName || 'Новая программа');

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsLesson, setEditIsLesson] = useState(false);
  const [editImageKey, setEditImageKey] = useState<string | null>(null);
  const [editPrerequisites, setEditPrerequisites] = useState<string[]>([]);
  const [editTextClosed, setEditTextClosed] = useState('');
  const [editTextOpen, setEditTextOpen] = useState('');
  const [editTextCompleted, setEditTextCompleted] = useState('');
  const [iconList, setIconList] = useState<string[]>([]);
  const [loadingIcons, setLoadingIcons] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const [isSelectingPrerequisites, setIsSelectingPrerequisites] = useState(false);
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const fetchIcons = async () => {
      setLoadingIcons(true);
      try {
        const { data, error } = await supabase.storage.from('icons').list();
        if (error) throw error;
        const files = data.map(f => f.name);
        setIconList(files);
      } catch (e) {
        console.error('Не удалось загрузить иконки:', e);
      }
      setLoadingIcons(false);
    };
    fetchIcons();
  }, []);

  const openEditor = (nodeId: string) => {
    const node = findNode(tree, nodeId);
    if (node) {
      setSelectedNodeId(nodeId);
      setEditName(node.name || '');
      setEditIsLesson(node.isLesson || false);
      setEditImageKey(node.imageKey || null);
      setEditPrerequisites(node.prerequisites || []);
      setEditTextClosed(node.textClosed || '');
      setEditTextOpen(node.textOpen || '');
      setEditTextCompleted(node.textCompleted || '');
      setModalOpen(true);
      setTimeout(() => setModalVisible(true), 10);
    }
  };

  const closeEditor = () => {
    setModalVisible(false);
    setTimeout(() => {
      setModalOpen(false);
      setSelectedNodeId(null);
    }, 200);
  };

  const saveNode = () => {
    if (!selectedNodeId) return;
    const updates: any = {
      name: editName,
      isLesson: editIsLesson,
      imageKey: editImageKey,
      prerequisites: editPrerequisites,
      textClosed: editTextClosed,
      textOpen: editTextOpen,
      textCompleted: editTextCompleted,
    };
    setTree((prev: any) => updateNodeInTree(prev, selectedNodeId, updates));
    closeEditor();
  };

  const handleAddChild = () => {
    if (!selectedNodeId) return;
    const { newTree } = findNodeAndAddChild(tree, selectedNodeId);
    setTree(newTree);
    closeEditor();
  };

  const handleDeleteNode = () => {
    if (!selectedNodeId || selectedNodeId === 'root') return;
    if (!confirm(`Удалить узел "${editName}"?`)) return;
    setTree((prev: any) => deleteNodeFromTree(prev, selectedNodeId));
    closeEditor();
  };

  const handleNodeClick = (nodeId: string) => {
    if (isSelectingPrerequisites) {
      if (nodeId === selectedNodeId) return;
      const node = findNode(tree, nodeId);
      if (!node || !node.isLesson) return;
      setTempSelectedIds(prev =>
        prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]
      );
      return;
    }
    openEditor(nodeId);
  };

  const handleSaveProgram = () => {
    const structure = JSON.parse(JSON.stringify(tree));
    onSave(programName, structure);
  };

  const startSelectingPrerequisites = () => {
    if (!selectedNodeId) return;
    setModalVisible(false);
    setTimeout(() => {
      setModalOpen(false);
      setIsSelectingPrerequisites(true);
      setTempSelectedIds([...editPrerequisites]);
    }, 200);
  };

  const finishSelectingPrerequisites = () => {
    if (!selectedNodeId) {
      setIsSelectingPrerequisites(false);
      return;
    }
    setEditPrerequisites([...tempSelectedIds]);
    setIsSelectingPrerequisites(false);
    const node = findNode(tree, selectedNodeId);
    if (node) {
      setModalOpen(true);
      setTimeout(() => setModalVisible(true), 10);
    }
  };

  const cancelSelectingPrerequisites = () => {
    setIsSelectingPrerequisites(false);
    if (!selectedNodeId) return;
    const node = findNode(tree, selectedNodeId);
    if (node) {
      setModalOpen(true);
      setTimeout(() => setModalVisible(true), 10);
    }
  };

  const renderModal = () => {
    if (!modalOpen || !selectedNodeId) return null;
    const isRoot = selectedNodeId === 'root';

    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 999,
          opacity: modalVisible ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
        onClick={closeEditor}
      >
        <div
          style={{
            backgroundColor: '#2a2a4e',
            padding: '30px',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '80%',
            overflow: 'auto',
            color: '#fff',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            transform: modalVisible ? 'scale(1)' : 'scale(0.95)',
            transition: 'transform 0.2s ease',
            position: 'relative',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={closeEditor}
            style={{
              position: 'absolute',
              top: '12px',
              right: '16px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontSize: '24px',
              cursor: 'pointer',
              transition: 'color 0.2s',
              padding: '4px 8px',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            ✕
          </button>

          <h2 style={{ marginBottom: '16px' }}>Редактировать узел</h2>
          <div style={{ marginBottom: '12px' }}>
            <label>Название</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#1a1a2e', color: '#fff' }}
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label>Тип</label>
            <div>
              <button
                onClick={() => setEditIsLesson(false)}
                style={{ background: editIsLesson ? '#555' : '#4CAF50', border: 'none', padding: '6px 12px', borderRadius: '4px', color: '#fff', cursor: 'pointer', marginRight: '8px' }}
              >
                📁 Папка
              </button>
              <button
                onClick={() => setEditIsLesson(true)}
                style={{ background: editIsLesson ? '#4CAF50' : '#555', border: 'none', padding: '6px 12px', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
              >
                📄 Урок
              </button>
            </div>
          </div>
          {editIsLesson && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <label>Текст в закрытом состоянии (краткое описание)</label>
                <textarea
                  value={editTextClosed}
                  onChange={(e) => setEditTextClosed(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#1a1a2e', color: '#fff', resize: 'vertical' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label>Текст в открытом состоянии (задания)</label>
                <textarea
                  value={editTextOpen}
                  onChange={(e) => setEditTextOpen(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#1a1a2e', color: '#fff', resize: 'vertical' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label>Текст после прохождения (материалы)</label>
                <textarea
                  value={editTextCompleted}
                  onChange={(e) => setEditTextCompleted(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#1a1a2e', color: '#fff', resize: 'vertical' }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label>Условия открытия</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={startSelectingPrerequisites}
                    style={{ background: '#4CAF50', border: 'none', padding: '6px 12px', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
                  >
                    🎯 Выбрать условия
                  </button>
                  <span style={{ color: '#aaa', fontSize: '0.9rem', alignSelf: 'center' }}>
                    {editPrerequisites.length > 0 ? `(${editPrerequisites.length} уроков)` : 'нет условий'}
                  </span>
                </div>
              </div>
            </>
          )}
          <div style={{ marginBottom: '12px' }}>
            <label>Иконка</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setEditImageKey(null)}
                style={{ background: editImageKey === null ? '#444' : 'transparent', border: '1px solid #555', borderRadius: '4px', padding: '4px 8px', color: '#fff', cursor: 'pointer' }}
              >
                🚫
              </button>
              {loadingIcons ? (
                <span>Загрузка...</span>
              ) : (
                iconList.map(file => (
                  <button
                    key={file}
                    onClick={() => setEditImageKey(file)}
                    style={{
                      background: editImageKey === file ? '#444' : 'transparent',
                      border: '1px solid #555',
                      borderRadius: '4px',
                      padding: 2,
                      cursor: 'pointer',
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img src={`${STORAGE_URL}${file}`} alt={file} style={{ width: 28, height: 28, borderRadius: '50%' }} />
                  </button>
                ))
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
            <button onClick={saveNode} style={{ background: '#2196F3', border: 'none', padding: '8px 16px', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
              💾 Сохранить
            </button>
            <button onClick={handleAddChild} style={{ background: '#4CAF50', border: 'none', padding: '8px 16px', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
              ➕ Добавить узел
            </button>
            {!isRoot && (
              <button onClick={handleDeleteNode} style={{ background: '#f44336', border: 'none', padding: '8px 16px', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
                🗑️
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 20, color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 20 }}>
        <button
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.3)',
            fontSize: '28px',
            cursor: 'pointer',
            padding: '4px 8px',
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
        >
          ←
        </button>
        <input
          type="text"
          value={programName}
          onChange={(e) => setProgramName(e.target.value)}
          style={{ background: 'transparent', color: '#fff', border: '1px solid #555', borderRadius: 4, padding: '4px 8px', fontSize: 20, fontWeight: 'bold', flex: 1 }}
          placeholder="Название программы"
        />
        <button
          onClick={handleSaveProgram}
          style={{
            padding: '6px 16px',
            background: '#4CAF50',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Сохранить
        </button>
      </div>
      {isSelectingPrerequisites ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: '#2a2a4e', borderRadius: '8px', marginBottom: '10px' }}>
            <span style={{ color: '#fff' }}>Выберите уроки, которые должны быть пройдены для открытия текущего урока. Кликните по уроку на дереве, чтобы отметить/снять.</span>
            <div>
              <button onClick={cancelSelectingPrerequisites} style={{ marginRight: '8px', padding: '6px 12px', background: '#555', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>Отмена</button>
              <button onClick={finishSelectingPrerequisites} style={{ padding: '6px 12px', background: '#4CAF50', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>✅ Готово</button>
            </div>
          </div>
          <div style={{ border: '1px solid #555', borderRadius: 8, padding: 10, height: '600px', overflow: 'auto' }}>
            <EditableTreeView
              structure={tree}
              onNodeClick={handleNodeClick}
              isSelectMode={true}
              onSelectToggle={(nodeId) => {
                if (nodeId === selectedNodeId) return;
                const node = findNode(tree, nodeId);
                if (!node || !node.isLesson) return;
                setTempSelectedIds(prev =>
                  prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]
                );
              }}
              selectedIds={tempSelectedIds}
            />
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #555', borderRadius: 8, padding: 10, height: '600px', overflow: 'auto' }}>
          <EditableTreeView structure={tree} onNodeClick={handleNodeClick} />
        </div>
      )}
      {renderModal()}
    </div>
  );
}

// ========== КОМПОНЕНТЫ ДЛЯ ОТОБРАЖЕНИЯ ==========

// Функция для сбора всех уроков с их prerequisites
function collectLessonsWithPrerequisites(node: any): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  function traverse(n: any) {
    if (n.isLesson === true) {
      map[n.id] = n.prerequisites || [];
    }
    if (n.children) {
      for (const child of n.children) {
        traverse(child);
      }
    }
  }
  traverse(node);
  return map;
}

// Функция рекурсивного пересчёта прогресса
function recalculateProgress(structure: any, progress: Record<string, boolean>): Record<string, boolean> {
  const newProgress = { ...progress };
  const lessons: any[] = [];
  function traverse(node: any) {
    if (node.isLesson === true) {
      lessons.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  traverse(structure);

  for (let iter = 0; iter < lessons.length; iter++) {
    let changed = false;
    for (const lesson of lessons) {
      const prereqs = lesson.prerequisites || [];
      const isLocked = prereqs.some((id: string) => !newProgress[id]);
      if (isLocked) {
        if (newProgress[lesson.id] === true) {
          newProgress[lesson.id] = false;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return newProgress;
}

function buildTreeForDisplay(node: any, progress: Record<string, boolean>, prerequisitesMap: Record<string, string[]>, isPreview: boolean = false): any {
  const isLesson = node.isLesson === true;
  const completed = isLesson ? (progress[node.id] || false) : false;
  let isLocked = false;
  let prereqCount = 0;
  if (isLesson && !isPreview) {
    const prereqs = prerequisitesMap[node.id] || [];
    isLocked = prereqs.some((id: string) => !progress[id]);
    prereqCount = prereqs.length;
  }
  return {
    name: node.name,
    __id: node.id,
    __isLesson: isLesson,
    __completed: completed,
    __locked: isLocked,
    __prereqCount: prereqCount,
    __imageUrl: node.imageKey ? `${STORAGE_URL}${node.imageKey}` : null,
    __imageKey: node.imageKey || null,
    __textClosed: node.textClosed || '',
    __textOpen: node.textOpen || '',
    __textCompleted: node.textCompleted || '',
    children: node.children ? node.children.map((child: any) => buildTreeForDisplay(child, progress, prerequisitesMap, isPreview)) : undefined,
  };
}

const renderCustomNode = ({ nodeDatum, onLessonClick, onToggleLesson, isPreview }: any) => {
  const isLesson = nodeDatum.__isLesson;
  const completed = nodeDatum.__completed;
  const locked = nodeDatum.__locked || false;
  const prereqCount = nodeDatum.__prereqCount || 0;
  const imageUrl = nodeDatum.__imageUrl;
  const textClosed = nodeDatum.__textClosed || '';
  const textOpen = nodeDatum.__textOpen || '';
  const textCompleted = nodeDatum.__textCompleted || '';
  const radius = 24;

  const handleClick = () => {
    if (isLesson) {
      if (onToggleLesson && !locked) {
        onToggleLesson(nodeDatum.__id);
      } else if (onLessonClick) {
        onLessonClick(
          nodeDatum.name,
          textClosed,
          textOpen,
          textCompleted,
          locked,
          completed,
          isPreview,
          prereqCount
        );
      }
    }
  };

  const clipId = `clip-${nodeDatum.__id || Math.random().toString(36).substring(2, 10)}`;
  const textColor = isLesson ? (completed ? '#4CAF50' : (locked ? '#666' : '#fff')) : '#fff';

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <circle cx="0" cy="0" r={radius} />
        </clipPath>
      </defs>

      {imageUrl ? (
        <image
          href={imageUrl}
          x="-24" y="-24"
          width="48" height="48"
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
          onClick={handleClick}
          style={{ cursor: isLesson && !locked ? 'pointer' : 'default', transform: 'scaleY(-1)', opacity: locked ? 0.5 : 1 }}
        />
      ) : (
        <circle
          r={radius}
          fill={isLesson ? (completed ? '#4CAF50' : (locked ? '#555' : '#FF9800')) : '#2196F3'}
          stroke="none"
          onClick={handleClick}
          style={{ cursor: isLesson && !locked ? 'pointer' : 'default' }}
        />
      )}

      <circle cx="0" cy="0" r={radius} fill="none" stroke="#fff" strokeWidth="2" onClick={handleClick} style={{ pointerEvents: 'none' }} />

      {isLesson && completed && (
        <>
          <circle cx="0" cy="0" r={radius} fill="rgba(76, 175, 80, 0.4)" stroke="none" onClick={handleClick} style={{ cursor: 'pointer' }} />
          <text x="0" y="2" fontSize={radius * 0.9} fill="rgba(255,255,255,0.8)" stroke="none" textAnchor="middle" dominantBaseline="central" fontWeight="bold" onClick={handleClick} style={{ cursor: 'pointer', transform: 'scaleY(-1)' }}>✓</text>
        </>
      )}

      {isLesson && locked && !completed && (
        <>
          <text x="0" y="2" fontSize={radius * 0.7} fill="#fff" stroke="none" textAnchor="middle" dominantBaseline="central" fontWeight="bold" onClick={handleClick} style={{ cursor: 'default', transform: 'scaleY(-1)' }}>🔒</text>
          {prereqCount > 1 && (
            <text x={radius + 6} y="0" fontSize={12} fill="#ffa500" stroke="none" textAnchor="start" dominantBaseline="central" fontWeight="bold" onClick={handleClick}>
              🔗{prereqCount}
            </text>
          )}
        </>
      )}

      <text
        fill={textColor}
        stroke="none"
        strokeWidth="0"
        x={radius + 10}
        y="4"
        fontSize={isLesson ? 14 : 16}
        fontFamily="Arial, sans-serif"
        textAnchor="start"
        style={{ fontWeight: isLesson ? 'normal' : 'bold', transform: 'scaleY(-1)', opacity: locked ? 0.5 : 1 }}
        onClick={handleClick}
      >
        {nodeDatum.name}
      </text>
    </g>
  );
};

function SkillTreeView({ structure, progress, onLessonClick, onToggleLesson, isPreview = false }: {
  structure: any;
  progress: Record<string, boolean>;
  onLessonClick?: (name: string, textClosed: string, textOpen: string, textCompleted: string, locked: boolean, completed: boolean, isPreview: boolean, prereqCount: number) => void;
  onToggleLesson?: (lessonId: string) => void;
  isPreview?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [translate, setTranslate] = useState({ x: 400, y: 100 });

  useEffect(() => {
    const updateTranslate = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        setTranslate({ x: width / 2, y: height - 150 });
      }
    };
    updateTranslate();
    window.addEventListener('resize', updateTranslate);
    return () => window.removeEventListener('resize', updateTranslate);
  }, []);

  const prerequisitesMap = collectLessonsWithPrerequisites(structure);
  const treeData = buildTreeForDisplay(structure, progress, prerequisitesMap, isPreview);
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', backgroundColor: '#1a1a2e', transform: 'scaleY(-1)' }}>
      <Tree
        data={treeData}
        orientation="vertical"
        pathFunc="step"
        renderCustomNodeElement={(props) => renderCustomNode({ ...props, onLessonClick, onToggleLesson, isPreview })}
        translate={translate}
        zoomable={true}
        draggable={true}
        separation={{ siblings: 1.5, nonSiblings: 1.5 }}
        nodeSize={{ x: 200, y: 100 }}
        collapsible={false}
      />
    </div>
  );
}

function StudentProgramList({ userId, onApply, existingProgramIds }: { userId: string; onApply: (programId: string) => void; existingProgramIds: string[] }) {
  const [availablePrograms, setAvailablePrograms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const all = await getVisiblePrograms();
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

function LessonModal({ isOpen, onClose, title, textClosed, textOpen, textCompleted, locked, completed, isPreview, prereqCount }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  textClosed: string;
  textOpen: string;
  textCompleted: string;
  locked: boolean;
  completed: boolean;
  isPreview: boolean;
  prereqCount: number;
}) {
  if (!isOpen) return null;

  const hasContent = textClosed || textOpen || textCompleted;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, cursor: 'pointer' }} onClick={onClose}>
      <div style={{ backgroundColor: '#2a2a4e', padding: '30px', borderRadius: '12px', maxWidth: '80%', maxHeight: '80%', overflow: 'auto', cursor: 'default', color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: '16px', borderBottom: '1px solid #555', paddingBottom: '8px' }}>{title}</h2>
        {locked && prereqCount > 0 && (
          <div style={{ marginBottom: '12px', color: '#ffa500' }}>
            <strong>🔗 Условия:</strong> требуется пройти {prereqCount} урок(а/ов).
          </div>
        )}
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' }}>
          {hasContent ? (
            <>
              {textClosed && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>📖 Описание:</strong>
                  <div>{textClosed}</div>
                </div>
              )}
              {!locked && textOpen && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>📝 Задания:</strong>
                  <div>{textOpen}</div>
                </div>
              )}
              {(completed || isPreview) && textCompleted && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>📚 Материалы:</strong>
                  <div>{textCompleted}</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#aaa' }}>Нет содержимого</div>
          )}
        </div>
        <button onClick={onClose} style={{ marginTop: '20px', padding: '8px 20px', backgroundColor: '#4CAF50', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}>Закрыть</button>
      </div>
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
  const [selectedStudentName, setSelectedStudentName] = useState<string | null>(null);

  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editingStructure, setEditingStructure] = useState<any>(null);
  const [editingProgramName, setEditingProgramName] = useState('');
  const [editingProgramVisible, setEditingProgramVisible] = useState(true);

  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [lessonModalTitle, setLessonModalTitle] = useState('');
  const [lessonModalTextClosed, setLessonModalTextClosed] = useState('');
  const [lessonModalTextOpen, setLessonModalTextOpen] = useState('');
  const [lessonModalTextCompleted, setLessonModalTextCompleted] = useState('');
  const [lessonModalLocked, setLessonModalLocked] = useState(false);
  const [lessonModalCompleted, setLessonModalCompleted] = useState(false);
  const [lessonModalIsPreview, setLessonModalIsPreview] = useState(false);
  const [lessonModalPrereqCount, setLessonModalPrereqCount] = useState(0);

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
      const progs = await getAllPrograms();
      const creatorIds = progs.map(p => p.created_by).filter(id => id);
      const nameMap = await getUsersByIds(creatorIds);
      const progsWithNames = progs.map(p => ({
        ...p,
        creator_name: nameMap[p.created_by] || p.created_by?.toString() || 'Неизвестный',
      }));
      const sorted = progsWithNames.sort((a, b) => {
        const aIsMine = a.created_by === Number(userId);
        const bIsMine = b.created_by === Number(userId);
        if (aIsMine && !bIsMine) return -1;
        if (!aIsMine && bIsMine) return 1;
        return a.name.localeCompare(b.name);
      });
      setPrograms(sorted);
    } else {
      const progs = await getStudentPrograms(userId);
      setPrograms(progs);
    }
    setView('programs');
    setCurrentProgramId(null);
    setSelectedStudentId(null);
    setSelectedStudentName(null);
  };

  const selectProgram = async (programId: string) => {
    setCurrentProgramId(programId);
    const prog = programs.find(p => p.id === programId);
    if (!prog) {
      alert('Программа не найдена');
      setView('programs');
      return;
    }
    if (!isAdmin && !prog.visible) {
      alert('Эта программа временно недоступна.');
      setView('programs');
      setCurrentProgramId(null);
      return;
    }
    setStructure(prog.structure);
    const progData = await loadProgressForProgram(userId, programId);
    setProgress(progData);
    if (isAdmin) {
      const apps = await getApplicationsForProgram(programId);
      setApplications(apps);
      const accepted = await getAcceptedStudents(programId);
      setAcceptedStudents(accepted);
      setView('admin');
      setSelectedStudentId(null);
      setSelectedStudentName(null);
    } else {
      setView('tree');
    }
  };

  const startEditingProgram = (programId: string) => {
    const prog = programs.find(p => p.id === programId);
    if (prog) {
      if (prog.created_by !== Number(userId)) {
        alert('Вы не можете редактировать эту программу, так как не являетесь её создателем.');
        return;
      }
      setEditingProgramId(programId);
      setEditingStructure(JSON.parse(JSON.stringify(prog.structure)));
      setEditingProgramName(prog.name);
      setEditingProgramVisible(prog.visible);
      setView('create');
    }
  };

  const handleSaveProgram = async (name: string, structure: any) => {
    if (editingProgramId) {
      const success = await updateProgram(editingProgramId, {
        name,
        structure,
        visible: editingProgramVisible,
      });
      if (success) {
        alert('Программа обновлена!');
        setEditingProgramId(null);
        setEditingStructure(null);
        setEditingProgramName('');
        loadPrograms();
      } else {
        alert('Ошибка обновления программы');
      }
    } else {
      const id = await createProgram(name, userId, structure);
      if (id) {
        alert('Программа создана!');
        loadPrograms();
      } else {
        alert('Ошибка создания программы');
      }
    }
  };

  const handleToggleVisibility = async (programId: string, currentVisible: boolean) => {
    const newState = !currentVisible;
    const action = newState ? 'открыть' : 'скрыть';
    if (!confirm(`Вы уверены, что хотите ${action} программу для учеников?`)) return;
    const success = await toggleProgramVisibility(programId, currentVisible);
    if (success) {
      loadPrograms();
    } else {
      alert('Ошибка переключения видимости');
    }
  };

  const handleCreateNewProgram = () => {
    setEditingProgramId(null);
    setEditingStructure(null);
    setEditingProgramName('');
    setEditingProgramVisible(true);
    setView('create');
  };

  const handleCancelEditor = () => {
    setEditingProgramId(null);
    setEditingStructure(null);
    setEditingProgramName('');
    setView('programs');
  };

  const handleDeleteProgram = async (programId: string, programName: string) => {
    if (!confirm(`Вы уверены, что хотите удалить программу "${programName}"? Это действие необратимо.`)) return;
    const success = await deleteProgram(programId);
    if (success) {
      alert('Программа удалена');
      loadPrograms();
    } else {
      alert('Ошибка удаления');
    }
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
    const student = acceptedStudents.find(s => s.id === studentId);
    setSelectedStudentName(student ? student.name : null);
  };

  const backToAdmin = () => {
    setSelectedStudentId(null);
    setSelectedStudentName(null);
    loadProgressForProgram(userId, currentProgramId!).then(p => setProgress(p));
  };

  const toggleLessonForStudent = async (lessonId: string) => {
    if (!selectedStudentId || !currentProgramId) return;
    if (!structure) return;

    const prerequisitesMap = collectLessonsWithPrerequisites(structure);
    const prereqs = prerequisitesMap[lessonId] || [];
    const isLocked = prereqs.some((id: string) => !progress[id]);
    if (isLocked) {
      alert('Этот урок ещё не открыт. Пройдите предыдущие уроки.');
      return;
    }

    let newProgress = { ...progress };
    newProgress[lessonId] = !progress[lessonId];
    newProgress = recalculateProgress(structure, newProgress);

    setProgress(newProgress);
    await saveProgressForProgram(selectedStudentId, currentProgramId, newProgress);
  };

  const handleDeleteStudent = async (studentId: string, studentName: string | null) => {
    if (!confirm(`Вы уверены, что хотите удалить ученика "${studentName || studentId}" из программы?`)) return;
    await supabase.from('progress').delete().eq('user_id', Number(studentId)).eq('program_id', currentProgramId!);
    await supabase.from('applications').delete().eq('student_id', Number(studentId)).eq('program_id', currentProgramId!);
    const accepted = await getAcceptedStudents(currentProgramId!);
    setAcceptedStudents(accepted);
    const apps = await getApplicationsForProgram(currentProgramId!);
    setApplications(apps);
    if (selectedStudentId === studentId) {
      setSelectedStudentId(null);
      setSelectedStudentName(null);
      loadProgressForProgram(userId, currentProgramId!).then(p => setProgress(p));
    }
  };

  const handleLessonClick = (name: string, textClosed: string, textOpen: string, textCompleted: string, locked: boolean, completed: boolean, isPreview: boolean, prereqCount: number) => {
    setLessonModalTitle(name);
    setLessonModalTextClosed(textClosed);
    setLessonModalTextOpen(textOpen);
    setLessonModalTextCompleted(textCompleted);
    setLessonModalLocked(locked);
    setLessonModalCompleted(completed);
    setLessonModalIsPreview(isPreview);
    setLessonModalPrereqCount(prereqCount);
    setLessonModalOpen(true);
  };

  const closeLessonModal = () => {
    setLessonModalOpen(false);
  };

  useEffect(() => {
    if (!userId || userId === 'guest' || !currentProgramId) return;

    const channel = supabase
      .channel(`progress-${userId}-${currentProgramId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'progress',
          filter: `user_id=eq.${userId},program_id=eq.${currentProgramId}`,
        },
        (payload) => {
          const { lesson_id, completed } = payload.new;
          setProgress(prev => ({
            ...prev,
            [lesson_id]: completed,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, currentProgramId]);

  // ========== ОТРИСОВКА ==========

  if (userId === 'guest') {
    return <div style={{ color: '#fff', padding: '20px' }}>Загрузка...</div>;
  }

  if (isAdmin && view === 'create') {
    return (
      <ProgramEditor
        initialStructure={editingStructure}
        initialName={editingProgramName}
        onSave={handleSaveProgram}
        onCancel={handleCancelEditor}
      />
    );
  }

  if (isAdmin && view === 'admin' && currentProgramId) {
    const currentProgram = programs.find(p => p.id === currentProgramId);
    const isCreator = currentProgram?.created_by === Number(userId);

    if (selectedStudentId) {
      return (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1a1a2e' }}>
          <div style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 10px' }}>
            <button
              onClick={backToAdmin}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.3)',
                fontSize: '28px',
                cursor: 'pointer',
                padding: '4px 8px',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
            >
              ←
            </button>
            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '18px' }}>{selectedStudentName || '...'}</span>
          </div>
          {isCreator ? (
            <SkillTreeView
              structure={structure}
              progress={progress}
              onToggleLesson={toggleLessonForStudent}
              onLessonClick={handleLessonClick}
            />
          ) : (
            <div style={{ color: '#fff', padding: '20px', textAlign: 'center' }}>
              <h3>Только для просмотра</h3>
              <SkillTreeView structure={structure} progress={progress} onLessonClick={handleLessonClick} />
            </div>
          )}
          <LessonModal
            isOpen={lessonModalOpen}
            onClose={closeLessonModal}
            title={lessonModalTitle}
            textClosed={lessonModalTextClosed}
            textOpen={lessonModalTextOpen}
            textCompleted={lessonModalTextCompleted}
            locked={lessonModalLocked}
            completed={lessonModalCompleted}
            isPreview={lessonModalIsPreview}
            prereqCount={lessonModalPrereqCount}
          />
        </div>
      );
    }

    return (
      <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
          <button
            onClick={() => { setView('programs'); setCurrentProgramId(null); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '28px',
              cursor: 'pointer',
              padding: '4px 8px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
          >
            ←
          </button>
          <h2 style={{ margin: 0, marginLeft: '8px' }}>Панель управления программой</h2>
        </div>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3>Дерево навыков (превью)</h3>
            <div style={{ height: '400px', overflow: 'auto', border: '1px solid #555', borderRadius: '8px', padding: '10px' }}>
              <SkillTreeView
                structure={structure}
                progress={progress}
                onLessonClick={handleLessonClick}
                isPreview={true}
              />
              <LessonModal
                isOpen={lessonModalOpen}
                onClose={closeLessonModal}
                title={lessonModalTitle}
                textClosed={lessonModalTextClosed}
                textOpen={lessonModalTextOpen}
                textCompleted={lessonModalTextCompleted}
                locked={lessonModalLocked}
                completed={lessonModalCompleted}
                isPreview={lessonModalIsPreview}
                prereqCount={lessonModalPrereqCount}
              />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h3>Заявки на вступление</h3>
            {applications.filter(a => a.status === 'pending').map(app => (
              <div key={app.id} style={{ marginBottom: '10px', backgroundColor: '#333', padding: '10px', borderRadius: '8px' }}>
                <span>{app.student_name || app.student_id}</span>
                {isCreator && (
                  <div>
                    <button onClick={() => handleAcceptApplication(app.id)} style={{ marginRight: '10px', backgroundColor: '#4CAF50' }}>✅ Принять</button>
                    <button onClick={() => handleRejectApplication(app.id)} style={{ backgroundColor: '#f44336' }}>❌ Отклонить</button>
                  </div>
                )}
              </div>
            ))}
            {applications.filter(a => a.status === 'pending').length === 0 && <p>Нет новых заявок</p>}

            <h3>Принятые ученики</h3>
            {acceptedStudents.map(student => (
              <div
                key={student.id}
                style={{
                  marginBottom: '10px',
                  backgroundColor: '#333',
                  padding: '10px',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: isCreator ? 'pointer' : 'default',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => { if (isCreator) e.currentTarget.style.backgroundColor = '#444'; }}
                onMouseLeave={(e) => { if (isCreator) e.currentTarget.style.backgroundColor = '#333'; }}
                onClick={() => { if (isCreator) handleSelectStudent(student.id); }}
              >
                <span>{student.name}</span>
                {isCreator && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteStudent(student.id, student.name); }}
                    style={{ backgroundColor: 'transparent', border: 'none', color: '#f44336', fontSize: '1.2rem', cursor: 'pointer' }}
                  >
                    🗑️
                  </button>
                )}
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
          <button
            onClick={() => { setView('programs'); setCurrentProgramId(null); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '28px',
              cursor: 'pointer',
              padding: '4px 8px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
          >
            ←
          </button>
          <span style={{ color: '#fff', marginLeft: '8px' }}>Программа: {programs.find(p => p.id === currentProgramId)?.name || ''}</span>
          <span style={{ color: '#fff', marginLeft: 'auto' }}>Ученик: {userName || userId}</span>
        </div>
        <SkillTreeView
          structure={structure}
          progress={progress}
          onLessonClick={handleLessonClick}
        />
        <LessonModal
          isOpen={lessonModalOpen}
          onClose={closeLessonModal}
          title={lessonModalTitle}
          textClosed={lessonModalTextClosed}
          textOpen={lessonModalTextOpen}
          textCompleted={lessonModalTextCompleted}
          locked={lessonModalLocked}
          completed={lessonModalCompleted}
          isPreview={lessonModalIsPreview}
          prereqCount={lessonModalPrereqCount}
        />
      </div>
    );
  }

  if (view === 'programs') {
    if (isAdmin) {
      return (
        <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Все программы</h2>
            <button
              onClick={handleCreateNewProgram}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.3)',
                fontSize: '30px',
                cursor: 'pointer',
                padding: '0 12px',
                lineHeight: 1,
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
            >
              +
            </button>
          </div>
          {programs.length === 0 && <p>Программ пока нет.</p>}
          {programs.map(prog => {
            const isCreator = prog.created_by === Number(userId);
            return (
              <div
                key={prog.id}
                style={{
                  margin: '10px 0',
                  backgroundColor: '#333',
                  padding: '15px',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#444'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#333'}
                onClick={() => selectProgram(prog.id)}
              >
                <div style={{ fontSize: '0.75rem', color: '#aaa', marginBottom: '2px' }}>
                  {prog.creator_name || 'Неизвестный создатель'}
                </div>
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {prog.name}
                </div>
                {isCreator && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleVisibility(prog.id, prog.visible); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: prog.visible ? '#4CAF50' : '#f44336',
                        fontSize: '1.2rem',
                        cursor: 'pointer',
                      }}
                    >
                      {prog.visible ? '👁️' : '🚫'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditingProgram(prog.id); }}
                      style={{ background: 'transparent', border: 'none', color: '#4CAF50', fontSize: '1.2rem', cursor: 'pointer' }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteProgram(prog.id, prog.name); }}
                      style={{ backgroundColor: 'transparent', border: 'none', color: '#f44336', fontSize: '1.2rem', cursor: 'pointer' }}
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    } else {
      return (
        <div style={{ padding: '20px', color: '#fff', backgroundColor: '#1a1a2e', minHeight: '100vh' }}>
          <h2>Мои программы</h2>
          {programs.length === 0 && <p>Вы ещё не приняты ни в одну программу. Подайте заявку ниже.</p>}
          {programs.map(prog => (
            <div
              key={prog.id}
              style={{
                margin: '10px 0',
                backgroundColor: '#333',
                padding: '15px',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#444'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#333'}
              onClick={() => selectProgram(prog.id)}
            >
              <span>{prog.name}</span>
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