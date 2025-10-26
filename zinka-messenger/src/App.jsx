import React, { useState, useEffect, useRef } from 'react';
import { Send, Image, Video, Mic, Search, Settings, Plus, X, User, Lock, Eye, EyeOff, LogOut, Save, Loader2 } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  addDoc, 
  setDoc, 
  updateDoc,
  deleteDoc,
  onSnapshot, 
  collection, 
  query, 
  where,
  serverTimestamp,
  Timestamp,
  setLogLevel
} from "firebase/firestore";

// --- Firebase Конфигурация (ОТКРЫТЫЕ КЛЮЧИ ДЛЯ ДЕПЛОЯ) ---
// Важно: Эти ключи БЕЗОПАСНЫ, т.к. они только для КЛИЕНТА (frontend)
const appId = 'ВАШ_ID_ПРИЛОЖЕНИЯ'; // Сюда вставь значение __app_id
const firebaseConfig = { // Сюда вставь содержимое __firebase_config как объект
  apiKey: "AIzaSy...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..."
};
// Мы убираем initialAuthToken, потому что он нужен только для этой среды.
const initialAuthToken = null; 
// Пользователь будет входить анонимно или создаст новый профиль

// --- Инициализация Firebase ---
let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  setLogLevel('Debug'); // Для отладки в консоли
} catch (e) {
  console.error("Ошибка инициализации Firebase:", e);
  // Можно показать ошибку пользователю
}

const App = () => { 
  // --- Состояния Аутентификации и Firebase ---
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userId, setUserId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // --- Состояния Приложения ---
  const [selectedChat, setSelectedChat] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [channelType, setChannelType] = useState('group');
  
  // --- Состояния Данных ---
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);

  // --- Редактирование профиля ---
  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    bio: '',
    privacy: { searchable: true }
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const chatContainerRef = useRef(null);

  // --- Эффект: Аутентификация ---
  // Срабатывает один раз при загрузке
  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Пользователь вошел
        setUserId(user.uid);
        await fetchUserProfile(user.uid);
        setIsAuthReady(true);
      } else {
        // Пользователь не вошел, пытаемся войти
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Ошибка входа:", error);
          setIsLoading(false); // Показать ошибку, если вход не удался
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Эффект: Загрузка Чатов ---
  // Срабатывает, когда аутентификация готова
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;

    setIsLoading(true);
    const chatsCollectionRef = collection(db, 'artifacts', appId, 'public/data/chats');
    const q = query(chatsCollectionRef, where("participants", "array-contains", userId));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const chatsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Сортировка на клиенте, как требуют инструкции (вместо orderBy)
      chatsData.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
        return timeB - timeA;
      });

      setChats(chatsData);
      setIsLoading(false);
    }, (error) => {
      console.error("Ошибка загрузки чатов:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthReady, userId]);

  // --- Эффект: Загрузка Сообщений ---
  // Срабатывает, когда выбран чат
  useEffect(() => {
    if (!isAuthReady || !db || !selectedChat) {
      setMessages([]);
      return;
    }

    const messagesCollectionRef = collection(db, 'artifacts', appId, 'public/data/chats', selectedChat.id, 'messages');
    
    // НЕ ИСПОЛЬЗУЕМ orderBy, сортируем на клиенте
    const unsubscribe = onSnapshot(messagesCollectionRef, (querySnapshot) => {
      const messagesData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Сортировка по времени (ASC)
      messagesData.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
        return timeA - timeB;
      });

      setMessages(messagesData);
    }, (error) => {
      console.error("Ошибка загрузки сообщений:", error);
    });

    return () => unsubscribe();
  }, [isAuthReady, selectedChat]);


  // --- Эффект: Прокрутка чата ---
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // --- Функция: Загрузка профиля пользователя ---
  const fetchUserProfile = async (uid) => {
    if (!db) return;
    
    const userDocRef = doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data');
    const docSnap = await getDoc(userDocRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      setCurrentUser({ id: uid, ...data });
      setProfileData({ ...data }); // Заполняем форму редактирования
    } else {
      // Новый пользователь, создаем профиль по умолчанию
      const defaultProfile = {
        firstName: 'Новый',
        lastName: 'Пользователь',
        username: `user_${uid.substring(0, 6)}`,
        bio: 'Привет! Я использую ZINKA',
        privacy: { searchable: true }
      };
      // Сохраняем в Firestore
      await setDoc(userDocRef, defaultProfile);
      // Сохраняем публичную часть (если searchable)
      await updatePublicProfile(uid, defaultProfile);

      setCurrentUser({ id: uid, ...defaultProfile });
      setProfileData(defaultProfile);
      setShowProfile(true); // Принудительно открываем профиль для нового пользователя
    }
  };

  // --- Функция: Обновление публичного профиля (для поиска) ---
  const updatePublicProfile = async (uid, profile) => {
    if (!db) return;
    const publicUserDocRef = doc(db, 'artifacts', appId, 'public/data/users', uid);

    if (profile.privacy.searchable) {
      // Создаем/Обновляем публичный профиль
      await setDoc(publicUserDocRef, {
        firstName: profile.firstName,
        lastName: profile.lastName,
        username: profile.username,
        bio: profile.bio,
      }, { merge: true });
    } else {
      // Удаляем публичный профиль, если поиск отключен
      await deleteDoc(publicUserDocRef).catch(e => console.warn("Doc to delete not found"));
    }
  };

  // --- Функция: Сохранение профиля ---
  const handleProfileUpdate = async () => {
    if (!db || !userId) return;

    const cleanUsername = profileData.username.replace('@', '');
    if (!validateUsername(cleanUsername)) {
      // Используем кастомный alert
      showCustomAlert('Юзернейм должен содержать минимум 4 символа (a-z, 0-9, _, -)');
      return;
    }
    if (!profileData.firstName.trim()) {
      showCustomAlert('Укажите имя');
      return;
    }

    setIsSavingProfile(true);

    try {
      // 1. Проверяем, свободен ли юзернейм (если он изменился)
      if (cleanUsername !== currentUser.username) {
        const publicUsersRef = collection(db, 'artifacts', appId, 'public/data/users');
        const q = query(publicUsersRef, where("username", "==", cleanUsername));
        const usernameSnap = await getDocs(q);
        if (!usernameSnap.empty) {
          showCustomAlert('Этот юзернейм уже занят');
          setIsSavingProfile(false);
          return;
        }
      }

      // 2. Обновляем приватный профиль
      const updatedProfile = { ...profileData, username: cleanUsername };
      const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'profile', 'data');
      await setDoc(userDocRef, updatedProfile, { merge: true });

      // 3. Обновляем публичный профиль
      await updatePublicProfile(userId, updatedProfile);
      
      // 4. Обновляем локальное состояние
      setCurrentUser({ id: userId, ...updatedProfile });

      showCustomAlert('Профиль сохранен!', 'success');
      setShowProfile(false);

    } catch (error) {
      console.error("Ошибка сохранения профиля:", error);
      showCustomAlert('Ошибка сохранения профиля');
    } finally {
      setIsSavingProfile(false);
    }
  };


  // --- Функция: Валидация юзернейма ---
  const validateUsername = (username) => {
    const regex = /^[a-zA-Z0-9_-]{4,}$/;
    return regex.test(username);
  };

  // --- Функция: Выход ---
  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    // onAuthStateChanged поймает это и автоматически обработает
    // (попытается войти анонимно)
    setCurrentUser(null);
    setUserId(null);
    setIsAuthReady(false);
    setSelectedChat(null);
    setChats([]);
    setMessages([]);
  };

  // --- Функция: Отправка сообщения ---
  const sendMessage = async () => {
    if (!message.trim() || !selectedChat || !db || !userId) return;

    const newMessage = {
      sender: userId,
      senderUsername: currentUser.username, // Добавим для отображения
      text: message,
      timestamp: serverTimestamp(), // Используем серверное время
      type: 'text'
    };

    try {
      // 1. Добавляем сообщение в подколлекцию
      const messagesCollectionRef = collection(db, 'artifacts', appId, 'public/data/chats', selectedChat.id, 'messages');
      await addDoc(messagesCollectionRef, newMessage);

      // 2. Обновляем последнее сообщение в чате
      const chatDocRef = doc(db, 'artifacts', appId, 'public/data/chats', selectedChat.id);
      await updateDoc(chatDocRef, {
        lastMessage: message,
        timestamp: serverTimestamp()
      });

      setMessage(''); // Очищаем поле ввода

    } catch (error) {
      console.error("Ошибка отправки сообщения:", error);
      showCustomAlert('Не удалось отправить сообщение');
    }
  };

  // --- Функция: Поиск и начало чата ---
  const startChat = async (user) => {
    if (!db || !currentUser || user.id === currentUser.id) return;
    
    // 1. Ищем существующий приватный чат
    const chatsCollectionRef = collection(db, 'artifacts', appId, 'public/data/chats');
    const q = query(
      chatsCollectionRef, 
      where("type", "==", "private"),
      where("participants", "array-contains", currentUser.id)
    );

    const querySnapshot = await getDocs(q);
    let existingChat = null;
    
    querySnapshot.forEach(doc => {
      const chat = doc.data();
      if (chat.participants.includes(user.id)) {
        existingChat = { id: doc.id, ...chat };
      }
    });

    if (existingChat) {
      // 2. Если чат есть, открываем его
      setSelectedChat(existingChat);
    } else {
      // 3. Если чата нет, создаем новый
      const newChat = {
        type: 'private',
        participants: [currentUser.id, user.id],
        // Создаем имена участников для отображения
        participantInfo: {
          [currentUser.id]: {
            username: currentUser.username,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName
          },
          [user.id]: {
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName
          }
        },
        lastMessage: '',
        timestamp: serverTimestamp()
      };
      
      try {
        const docRef = await addDoc(chatsCollectionRef, newChat);
        setSelectedChat({ id: docRef.id, ...newChat });
      } catch (error) {
        console.error("Ошибка создания чата:", error);
        showCustomAlert('Не удалось создать чат');
      }
    }
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // --- Функция: Создание канала/группы ---
  const createChannel = async () => {
    if (!channelName.trim() || !db || !currentUser) {
      showCustomAlert('Введите название');
      return;
    }

    const newChannel = {
      type: channelType,
      name: channelName,
      description: channelDesc,
      creator: currentUser.id,
      participants: [currentUser.id], // participants = members
      participantInfo: {
        [currentUser.id]: {
            username: currentUser.username,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName
          }
      },
      lastMessage: '',
      timestamp: serverTimestamp()
    };

    try {
      const chatsCollectionRef = collection(db, 'artifacts', appId, 'public/data/chats');
      const docRef = await addDoc(chatsCollectionRef, newChannel);
      
      setShowCreateChannel(false);
      setChannelName('');
      setChannelDesc('');
      setSelectedChat({ id: docRef.id, ...newChannel });

    } catch (error) {
      console.error("Ошибка создания канала:", error);
      showCustomAlert('Не удалось создать канал');
    }
  };

  // --- Функция: Поиск пользователей ---
  const handleSearch = async () => {
    if (!searchQuery.trim() || !db || !currentUser) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    const cleanQuery = searchQuery.replace('@', '').toLowerCase();

    try {
      // Ищем по ТОЧНОМУ юзернейму
      const publicUsersRef = collection(db, 'artifacts', appId, 'public/data/users');
      const q = query(publicUsersRef, where("username", "==", cleanQuery));
      
      const querySnapshot = await getDocs(q);
      
      const usersData = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(user => user.id !== currentUser.id); // Исключаем себя из поиска
      
      setSearchResults(usersData);

    } catch (error) {
      console.error("Ошибка поиска:", error);
      showCustomAlert('Ошибка поиска');
    } finally {
      setIsSearching(false);
    }
  };

  // --- Хелперы: Отображение ---

  const getUserInitial = (user) => {
    if (!user) return '?';
    return user.firstName ? user.firstName[0].toUpperCase() : (user.username ? user.username[0].toUpperCase() : '?');
  };

  const getUserFullName = (user) => {
    if (!user) return 'Загрузка...';
    return (user.firstName + ' ' + (user.lastName || '')).trim();
  };
  
  // Динамическое имя чата
  const getChatName = (chat) => {
    if (chat.type === 'private') {
      // Находим ID другого участника
      const otherUserId = chat.participants.find(id => id !== userId);
      if (!otherUserId || !chat.participantInfo || !chat.participantInfo[otherUserId]) {
        return "Приватный чат";
      }
      // Берем его имя из participantInfo
      const info = chat.participantInfo[otherUserId];
      return (info.firstName + ' ' + (info.lastName || '')).trim();
    }
    // Для групп и каналов
    return chat.name;
  };
  
  // Динамический инициал чата
  const getChatInitial = (chat) => {
    const name = getChatName(chat);
    return name ? name[0].toUpperCase() : '?';
  };

  // --- Хелпер: Кастомный Alert ---
  // (alert() блокирует UI, используем неблокирующий)
  const showCustomAlert = (message, type = 'error') => {
    // В реальном приложении здесь бы использовалась
    // красивая неблокирующая toast-нотификация.
    // Для простоты используем console.warn
    if (type === 'error') {
      console.warn(`ALERT: ${message}`);
    } else {
      console.log(`SUCCESS: ${message}`);
    }
    // alert(message); // ИЗБЕГАЕМ alert()
  };

  // --- Компонент: Звездный фон ---
  const StarryBackground = () => (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {[...Array(150)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white animate-pulse"
          style={{
            width: Math.random() * 2 + 0.5 + 'px',
            height: Math.random() * 2 + 0.5 + 'px',
            top: Math.random() * 100 + '%',
            left: Math.random() * 100 + '%',
            animationDelay: Math.random() * 3 + 's',
            animationDuration: Math.random() * 2 + 2 + 's',
            opacity: Math.random() * 0.5 + 0.3
          }}
        />
      ))}
    </div>
  );

  // --- Рендер: Экран загрузки ---
  if (!isAuthReady || !currentUser || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black relative overflow-hidden flex items-center justify-center">
        <StarryBackground />
        <div className="relative z-10 text-center">
           <Loader2 className="w-16 h-16 text-blue-400 animate-spin mx-auto mb-4" />
           <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 mb-2">
             ZINKA
           </h1>
           <p className="text-slate-400 text-lg">Подключение к космосу...</p>
        </div>
      </div>
    );
  }

  // --- Рендер: Основной интерфейс ---
  return (
    <div className="h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-black relative overflow-hidden flex">
      <StarryBackground />
      
      {/* --- Левая панель (Чаты) --- */}
      <div className="relative z-10 w-full sm:w-80 bg-gray-900/60 backdrop-blur-xl border-r border-slate-700/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">ZINKA</h2>
            <div className="flex gap-2 items-center">
              <button onClick={() => setShowSearch(true)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><Search size={20} /></button>
              <button onClick={() => setShowCreateChannel(true)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><Plus size={20} /></button>
              <button onClick={() => setShowProfile(true)} className="ml-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg hover:scale-110 transition-transform cursor-pointer">
                  {getUserInitial(currentUser)}
                </div>
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {chats.length === 0 ? (
            <div className="p-4 text-center text-slate-400"><p>Нет чатов. Начните новый через поиск.</p></div>
          ) : (
            chats.map(chat => (
              <div key={chat.id} onClick={() => setSelectedChat(chat)} className={'p-4 cursor-pointer transition-all border-l-4 ' + (selectedChat?.id === chat.id ? 'bg-slate-800/40 border-blue-500' : 'border-transparent hover:bg-slate-800/20')}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
                    {getChatInitial(chat)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-medium truncate">{getChatName(chat)}</h3>
                      <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
                        {chat.timestamp?.toDate ? chat.timestamp.toDate().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 truncate">{chat.lastMessage || 'Нет сообщений'}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- Правая панель (Чат) --- */}
      <div className="relative z-10 flex-1 flex flex-col max-w-full overflow-hidden">
        {selectedChat ? (
          <>
            <div className="bg-gray-900/60 backdrop-blur-xl border-b border-slate-700/50 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
                  {getChatInitial(selectedChat)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-white font-medium truncate">{getChatName(selectedChat)}</h3>
                  <p className="text-xs text-slate-400">
                    {selectedChat.type === 'private' ? 'онлайн' : `${selectedChat.participants.length} участ.`}
                  </p>
                </div>
              </div>
            </div>
            
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className={'flex ' + (msg.sender === currentUser.id ? 'justify-end' : 'justify-start')}>
                  <div className={'max-w-md px-4 py-2 rounded-2xl shadow-lg ' + (msg.sender === currentUser.id ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'bg-slate-800/60 text-white')}>
                    {/* Показываем имя отправителя в группах */}
                    {selectedChat.type !== 'private' && msg.sender !== currentUser.id && (
                       <p className="text-xs font-bold text-blue-300 mb-1">{msg.senderUsername || 'Кто-то'}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    <span className="text-xs opacity-70 mt-1 block text-right">
                      {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '...'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="bg-gray-900/60 backdrop-blur-xl border-t border-slate-700/50 p-4">
              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><Image size={20} /></button>
                <button className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><Mic size={20} /></button>
                <input 
                  type="text" 
                  value={message} 
                  onChange={(e) => setMessage(e.target.value)} 
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()} 
                  placeholder="Сообщение..." 
                  className="flex-1 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" 
                />
                <button onClick={sendMessage} className="p-2 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg hover:shadow-lg transition-all text-white">
                  <Send size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-4">
              <div className="text-6xl mb-4">⭐</div>
              <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">Добро пожаловать в ZINKA</h3>
              <p className="text-slate-400">Выберите чат, чтобы начать общение, или найдите друга через поиск.</p>
            </div>
          </div>
        )}
      </div>

      {/* --- Модальное окно: Профиль / Редактирование --- */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 backdrop-blur-xl rounded-3xl p-6 w-full max-w-md border border-slate-700/50 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Профиль</h3>
              <button onClick={() => setShowProfile(false)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><X size={20} /></button>
            </div>
            
            <div className="text-center mb-6">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-lg">
                {profileData.firstName ? profileData.firstName[0].toUpperCase() : '?'}
              </div>
            </div>
            
            <div className="space-y-4 mb-6">
              <input type="text" placeholder="Имя*" value={profileData.firstName} onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })} className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" />
              <input type="text" placeholder="Фамилия" value={profileData.lastName} onChange={(e) => setProfileData({ ...profileData, lastName: e.target.value })} className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" />
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">@</span>
                <input type="text" placeholder="юзернейм" value={profileData.username.replace('@', '')} onChange={(e) => setProfileData({ ...profileData, username: e.target.value.replace('@', '') })} className="w-full pl-8 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" />
              </div>
              <textarea placeholder="Описание" value={profileData.bio} onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })} className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all resize-none" rows="3"></textarea>
              
              <label className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg cursor-pointer">
                <span className="text-white">Поиск по юзернейму</span>
                <input type="checkbox" checked={profileData.privacy.searchable} onChange={(e) => setProfileData({ ...profileData, privacy: {...profileData.privacy, searchable: e.target.checked }})} className="w-5 h-5 rounded text-blue-500 focus:ring-0" />
              </label>

              <div className="p-3 bg-slate-800/30 rounded-lg">
                <span className="text-sm text-slate-400">Ваш ID (для друзей):</span>
                <p className="text-white text-xs break-all">{userId}</p>
              </div>

              <button onClick={handleProfileUpdate} disabled={isSavingProfile} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {isSavingProfile ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                {isSavingProfile ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

            <div className="border-t border-slate-700/50 pt-4">
              <button onClick={handleLogout} className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 rounded-lg transition-all text-red-400"><LogOut size={20} /><span>Выйти</span></button>
            </div>
          </div>
        </div>
      )}
      
      {/* --- Модальное окно: Поиск --- */}
      {showSearch && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 backdrop-blur-xl rounded-3xl p-6 w-full max-w-md border border-slate-700/50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Поиск</h3>
              <button onClick={() => setShowSearch(false)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><X size={20} /></button>
            </div>
            
            <div className="flex items-center gap-2 mb-4">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSearch()} placeholder="Точный юзернейм (без @)" className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" />
              <button onClick={handleSearch} disabled={isSearching} className="p-3 bg-blue-600 rounded-xl text-white disabled:opacity-50">
                {isSearching ? <Loader2 className="animate-spin" size={24} /> : <Search size={24} />}
              </button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {searchResults.length > 0 ? (
                searchResults.map(user => (
                  <div key={user.id} onClick={() => startChat({id: user.id, ...user})} className="flex items-center gap-3 p-3 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-all">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
                      {getUserInitial(user)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white font-medium truncate">{getUserFullName(user)}</h4>
                      <p className="text-sm text-slate-400 truncate">@{user.username}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-slate-400 text-center p-4">{isSearching ? 'Ищем...' : 'Нет результатов'}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Модальное окно: Создать канал --- */}
      {showCreateChannel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 backdrop-blur-xl rounded-3xl p-6 w-full max-w-md border border-slate-700/50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Создать</h3>
              <button onClick={() => setShowCreateChannel(false)} className="p-2 hover:bg-slate-800/50 rounded-lg transition-all text-slate-400"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2 mb-4">
                <button onClick={() => setChannelType('group')} className={'flex-1 py-2 rounded-lg font-medium transition-all ' + (channelType === 'group' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'bg-slate-800/50 text-slate-300')}>Группа</button>
                <button onClick={() => setChannelType('channel')} className={'flex-1 py-2 rounded-lg font-medium transition-all ' + (channelType === 'channel' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' : 'bg-slate-800/50 text-slate-300')}>Канал</button>
              </div>
              <input type="text" value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Название" className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all" />
              <textarea value={channelDesc} onChange={(e) => setChannelDesc(e.target.value)} placeholder="Описание" className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all resize-none" rows="3"></textarea>
              <button onClick={createChannel} className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:shadow-lg transition-all">Создать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default App;
