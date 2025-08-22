// Socket.IO 연결
let socket = null;
let isConnected = false;

// 게임 상태 관리
class GameState {
    constructor() {
        this.currentScreen = 'mainMenu';
        this.nickname = '';
        this.selectedCharacter = 1;
        this.currentRoom = null;
        this.isHost = false;
        this.isReady = false;
        this.gameStarted = false;
        this.playerId = null;
        this.chatMode = 'all';
        this.onlineUsers = 0;
        this.lastPing = 0;
    }
}

const gameState = new GameState();

// Socket.IO 연결 설정
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('서버에 연결됨');
        isConnected = true;
        updateConnectionStatus(true);
        document.getElementById('chatInput').disabled = false;
        document.getElementById('sendChat').disabled = false;
        
        // 연결 성공 메시지
        addSystemMessage('서버에 연결되었습니다.');
    });
    
    socket.on('disconnect', () => {
        console.log('서버 연결 끊김');
        isConnected = false;
        updateConnectionStatus(false);
        document.getElementById('chatInput').disabled = true;
        document.getElementById('sendChat').disabled = true;
        
        addSystemMessage('서버 연결이 끊어졌습니다.');
    });
    
    // 닉네임 설정 응답
    socket.on('nicknameSet', (data) => {
        if (data.success) {
            gameState.playerId = socket.id;
            addSystemMessage(`${data.nickname}님으로 로그인되었습니다.`);
        }
    });
    
    // 방 목록 업데이트
    socket.on('roomListUpdate', () => {
        if (gameState.currentScreen === 'roomList') {
            loadRooms();
        }
    });
    
    // 방 생성 성공
    socket.on('roomCreated', (data) => {
        gameState.currentRoom = data.room;
        gameState.isHost = true;
        showScreen('waitingRoom');
        updateWaitingRoom(data.room);
        addSystemMessage(`방 "${data.room.name}"을 생성했습니다.`);
    });
    
    // 방 입장 성공
    socket.on('roomJoined', (data) => {
        gameState.currentRoom = data.room;
        gameState.isHost = false;
        showScreen('waitingRoom');
        updateWaitingRoom(data.room);
        addSystemMessage(`방 "${data.room.name}"에 입장했습니다.`);
    });
    
    // 방 정보 업데이트
    socket.on('roomUpdate', (room) => {
        gameState.currentRoom = room;
        if (gameState.currentScreen === 'waitingRoom') {
            updateWaitingRoom(room);
        }
    });
    
    // 게임 시작
    socket.on('gameStart', (gameData) => {
        startGame(gameData);
    });
    
    // 게임 상태 업데이트
    socket.on('gameUpdate', (gameData) => {
        if (game) {
            game.updateGameData(gameData);
        }
    });
    
    // 게임 종료
    socket.on('gameEnd', (result) => {
        endGame(result);
    });
    
    // 특수 공격 알림
    socket.on('specialAttack', (data) => {
        showGameStatus(`${data.player} 특수공격! (${data.damage} 데미지)`);
    });
    
    // 재장전 완료
    socket.on('reloadComplete', (data) => {
        showGameStatus(`${data.player} 재장전 완료!`);
    });
    
    // 채팅 메시지
    socket.on('chatMessage', (message) => {
        addChatMessage(message);
    });
    
    // 시스템 메시지
    socket.on('systemMessage', (message) => {
        addSystemMessage(message);
    });
    
    // 온라인 유저 수 업데이트
    socket.on('onlineCount', (count) => {
        gameState.onlineUsers = count;
        document.getElementById('onlineCount').textContent = count;
    });
    
    // 에러 메시지
    socket.on('error', (message) => {
        showError(message);
    });
    
    // 핑 측정
    setInterval(() => {
        if (isConnected) {
            const start = Date.now();
            socket.emit('ping', start);
            socket.on('pong', (timestamp) => {
                gameState.lastPing = Date.now() - timestamp;
                document.getElementById('pingDisplay').textContent = `핑: ${gameState.lastPing}ms`;
            });
        }
    }, 5000);
}

// 채팅 시스템
function addChatMessage(message) {
    const container = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    
    // 현재 채팅 모드에 따라 필터링
    if (gameState.chatMode === 'room' && message.type !== 'room' && message.type !== 'system') {
        return;
    }
    
    if (message.type === 'system') {
        messageDiv.className = 'system-message';
        messageDiv.textContent = message.content;
    } else {
        messageDiv.className = `chat-message ${message.type === 'room' ? 'room-message' : ''}`;
        messageDiv.innerHTML = `
            <span class="message-time">${formatTime(message.timestamp)}</span>
            <span class="message-sender">${message.sender}:</span>
            <span class="message-content">${escapeHtml(message.content)}</span>
        `;
    }
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    // 메시지가 너무 많으면 오래된 것 삭제
    while (container.children.length > 100) {
        container.removeChild(container.firstChild);
    }
}

function addSystemMessage(content) {
    addChatMessage({
        sender: 'System',
        content: content,
        type: 'system',
        timestamp: Date.now()
    });
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message && isConnected && gameState.nickname) {
        socket.emit('chatMessage', {
            message: message,
            type: gameState.chatMode
        });
        
        // 내 메시지는 즉시 표시
        addChatMessage({
            sender: gameState.nickname,
            content: message,
            type: gameState.chatMode,
            timestamp: Date.now()
        });
        
        input.value = '';
    }
}

// 게임 로직 클래스
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.keys = {};
        this.mouse = { x: 0, y: 0, clicked: false };
        this.gameLoop = null;
        this.startTime = 0;
        this.gameData = null;
        this.myPlayerKey = null;
        this.lastActionTime = 0;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // 키보드 이벤트
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            if (e.key.toLowerCase() === 'r') {
                this.reload();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // 마우스 이벤트
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        });
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.mouse.clicked = true;
                this.attack();
            }
        });
        
        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.mouse.clicked = false;
            }
        });
    }
    
    start(gameData) {
        this.gameData = gameData;
        this.startTime = Date.now();
        
        // 내 플레이어 키 찾기
        const room = gameState.currentRoom;
        const myIndex = room.players.findIndex(p => p.id === gameState.playerId);
        this.myPlayerKey = `player${myIndex + 1}`;
        
        this.gameLoop = setInterval(() => {
            this.update();
            this.render();
        }, 1000 / 60);
    }
    
    stop() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }
    
    update() {
        this.updateMovement();
        this.updateTimer();
    }
    
    updateMovement() {
        if (!this.myPlayerKey || !this.gameData) return;
        
        const now = Date.now();
        if (now - this.lastActionTime < 50) return; // 20fps로 제한
        
        let dx = 0, dy = 0;
        
        if (this.keys['w']) dy = -1;
        if (this.keys['s']) dy = 1;
        if (this.keys['a']) dx = -1;
        if (this.keys['d']) dx = 1;
        
        if (dx !== 0 || dy !== 0) {
            socket.emit('gameAction', {
                type: 'move',
                dx: dx,
                dy: dy
            });
            
            this.lastActionTime = now;
        }
    }
    
    attack() {
        if (!this.myPlayerKey || !this.gameData) return;
        
        const player = this.gameData[this.myPlayerKey];
        if (player.bullets <= 0) return;
        
        const dx = this.mouse.x - player.x;
        const dy = this.mouse.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            socket.emit('gameAction', {
                type: 'attack',
                dx: dx / distance,
                dy: dy / distance,
                mouseX: this.mouse.x,
                mouseY: this.mouse.y
            });
        }
    }
    
    reload() {
        if (!this.myPlayerKey || !this.gameData) return;
        
        socket.emit('gameAction', {
            type: 'reload'
        });
        
        showGameStatus('재장전 중...');
    }
    
    updateGameData(gameData) {
        this.gameData = gameData;
        this.updateUI();
    }
    
    updateUI() {
        if (!this.gameData) return;
        
        // 체력 업데이트
        this.updateHealthDisplay('player1', this.gameData.player1);
        this.updateHealthDisplay('player2', this.gameData.player2);
        
        // 총알 업데이트
        this.updateBulletDisplay('player1', this.gameData.player1.bullets);
        this.updateBulletDisplay('player2', this.gameData.player2.bullets);
    }
    
    updateHealthDisplay(playerKey, playerData) {
        const maxHealth = playerData.char === 1 ? 100 : 70;
        const healthBar = document.getElementById(`${playerKey}Health`);
        const healthText = healthBar.nextElementSibling;
        
        const percentage = (playerData.health / maxHealth) * 100;
        healthBar.style.width = `${percentage}%`;
        healthText.textContent = `${playerData.health}/${maxHealth}`;
        
        // 색상 변경
        if (percentage > 60) {
            healthBar.style.background = 'linear-gradient(90deg, #4CAF50, #45a049)';
        } else if (percentage > 30) {
            healthBar.style.background = 'linear-gradient(90deg, #FF9800, #F57C00)';
        } else {
            healthBar.style.background = 'linear-gradient(90deg, #f44336, #d32f2f)';
        }
    }
    
    updateBulletDisplay(playerKey, bullets) {
        const bulletElements = document.querySelectorAll(`#${playerKey}Bullets .bullet`);
        bulletElements.forEach((bullet, index) => {
            if (index < bullets) {
                bullet.classList.add('filled');
            } else {
                bullet.classList.remove('filled');
            }
        });
    }
    
    updateTimer() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById('gameTimer').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    render() {
        if (!this.gameData) return;
        
        // 배경 클리어
        this.ctx.fillStyle = '#2c3e50';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 격자 패턴
        this.drawGrid();
        
        // 경기장 경계
        this.ctx.strokeStyle = '#ecf0f1';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(5, 5, this.canvas.width - 10, this.canvas.height - 10);
        
        // 플레이어 렌더링
        this.renderPlayer(this.gameData.player1, '#4b96ff', '1');
        this.renderPlayer(this.gameData.player2, '#ff4b4b', '2');
        
        // 이펙트 렌더링 (총알 궤적 등)
        this.renderEffects();
    }
    
    drawGrid() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.ctx.lineWidth = 1;
        
        for (let x = 0; x < this.canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        for (let y = 0; y < this.canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }
    
    renderPlayer(player, color, number) {
        // 플레이어 그림자
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.beginPath();
        this.ctx.ellipse(player.x + 2, player.y + 27, 23, 8, 0, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 플레이어 몸체
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 테두리
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        // 플레이어 눈
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(player.x - 8, player.y - 8, 4, 0, Math.PI * 2);
        this.ctx.arc(player.x + 8, player.y - 8, 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.fillStyle = 'black';
        this.ctx.beginPath();
        this.ctx.arc(player.x - 8, player.y - 8, 2, 0, Math.PI * 2);
        this.ctx.arc(player.x + 8, player.y - 8, 2, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 플레이어 입
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(player.x, player.y + 5, 8, 0, Math.PI);
        this.ctx.stroke();
        
        // 플레이어 번호
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(number, player.x, player.y + 4);
        
        // 체력 바
        const maxHealth = player.char === 1 ? 100 : 70;
        const healthPercent = player.health / maxHealth;
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(player.x - 30, player.y - 45, 60, 8);
        
        this.ctx.fillStyle = healthPercent > 0.6 ? '#4CAF50' : 
                           healthPercent > 0.3 ? '#FF9800' : '#f44336';
        this.ctx.fillRect(player.x - 28, player.y - 43, 56 * healthPercent, 4);
        
        // 총알 표시
        for (let i = 0; i < 3; i++) {
            this.ctx.fillStyle = i < player.bullets ? '#FFD700' : 'rgba(255, 255, 255, 0.3)';
            this.ctx.beginPath();
            this.ctx.arc(player.x - 15 + i * 15, player.y - 55, 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    
    renderEffects() {
        // 여기에 특수 효과들 (총알 궤적, 폭발 등) 렌더링
    }
}

// UI 관리 함수들
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
    gameState.currentScreen = screenId;
}

function updateConnectionStatus(connected) {
    const status = document.getElementById('connectionStatus');
    if (connected) {
        status.textContent = '연결됨';
        status.className = 'connected';
    } else {
        status.textContent = '연결 끊김';
        status.className = 'disconnected';
    }
}

function showError(message) {
    const notification = document.getElementById('errorNotification');
    const messageElement = document.getElementById('errorMessage');
    
    messageElement.textContent = message;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 5000);
}

function showGameStatus(message) {
    const status = document.getElementById('gameStatus');
    status.textContent = message;
    
    setTimeout(() => {
        status.textContent = '게임 진행 중';
    }, 2000);
}

// 닉네임 설정
function setNickname() {
    const nicknameInput = document.getElementById('nickname');
    const nickname = nicknameInput.value.trim();
    
    if (nickname.length < 2) {
        showError('닉네임은 2글자 이상이어야 합니다.');
        return;
    }
    
    if (!isConnected) {
        showError('서버에 연결되지 않았습니다.');
        return;
    }
    
    gameState.nickname = nickname;
    document.getElementById('currentNickname').textContent = nickname;
    document.querySelector('.nickname-input').classList.add('hidden');
    document.getElementById('playerName').classList.remove('hidden');
    
    // 서버에 닉네임 전송
    socket.emit('setNickname', nickname);
}

// 방 목록 로드
async function loadRooms() {
    const container = document.getElementById('roomsContainer');
    container.innerHTML = '<div class="loading">방 목록을 불러오는 중...</div>';
    
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        
        if (rooms.length === 0) {
            container.innerHTML = '<div class="no-rooms">생성된 방이 없습니다.</div>';
            return;
        }
        
        container.innerHTML = '';
        rooms.forEach(room => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room-item';
            roomDiv.innerHTML = `
                <div class="room-info">
                    <div class="room-name">${escapeHtml(room.name)}</div>
                    <div class="room-players">${room.players}</div>
                </div>
            `;
            
            if (!room.isFull) {
                roomDiv.addEventListener('click', () => joinRoom(room.id));
            } else {
                roomDiv.style.opacity = '0.5';
                roomDiv.style.cursor = 'not-allowed';
            }
            
            container.appendChild(roomDiv);
        });
    } catch (error) {
        container.innerHTML = '<div class="error">방 목록을 불러올 수 없습니다.</div>';
        console.error('방 목록 로드 실패:', error);
    }
}

// 방 입장
function joinRoom(roomId) {
    if (!gameState.nickname) {
        showError('먼저 닉네임을 설정해주세요.');
        return;
    }
    
    socket.emit('joinRoom', roomId);
}

// 방 생성
function createRoom() {
    const roomName = document.getElementById('roomName').value.trim();
    if (!roomName) {
        showError('방 이름을 입력해주세요.');
        return;
    }
    
    if (!gameState.nickname) {
        showError('먼저 닉네임을 설정해주세요.');
        return;
    }
    
    socket.emit('createRoom', {
        roomName: roomName,
        character: gameState.selectedCharacter
    });
}

// 대기실 업데이트
function updateWaitingRoom(room) {
    const player1Slot = document.getElementById('player1Slot');
    const player2Slot = document.getElementById('player2Slot');
    const startButton = document.getElementById('startGameBtn');
    const readyButton = document.getElementById('readyBtn');
    
    // 플레이어 정보 초기화
    [player1Slot, player2Slot].forEach((slot, index) => {
        const player = room.players[index];
        
        if (player) {
            slot.querySelector('.player-nick').textContent = player.nickname;
            slot.querySelector('.player-char').textContent = `애새이 ${player.character}호`;
            slot.querySelector('.player-ready').textContent = player.ready ? '준비됨' : '준비 안됨';
            slot.querySelector('.player-ready').className = 
                `player-ready ${player.ready ? 'ready' : 'not-ready'}`;
        } else {
            slot.querySelector('.player-nick').textContent = '대기중...';
            slot.querySelector('.player-char').textContent = '캐릭터 미선택';
            slot.querySelector('.player-ready').textContent = '준비 안됨';
            slot.querySelector('.player-ready').className = 'player-ready not-ready';
        }
    });
    
    // 게임 시작 버튼 (방장이고 모든 플레이어가 준비됨)
    const allReady = room.players.length === 2 && room.players.every(p => p.ready);
    if (gameState.isHost && allReady) {
        startButton.classList.remove('hidden');
    } else {
        startButton.classList.add('hidden');
    }
    
    // 준비 버튼 상태
    const myPlayer = room.players.find(p => p.id === gameState.playerId);
    if (myPlayer) {
        readyButton.textContent = myPlayer.ready ? '준비 취소' : '준비';
        readyButton.className = `menu-btn ${myPlayer.ready ? 'secondary' : ''}`;
    }
}

// 준비 상태 토글
function toggleReady() {
    socket.emit('toggleReady');
}

// 캐릭터 변경
function changeCharacter() {
    const select = document.getElementById('characterSelect');
    const character = parseInt(select.value);
    
    gameState.selectedCharacter = character;
    socket.emit('changeCharacter', character);
}

// 게임 시작
function startGameAsHost() {
    socket.emit('startGame');
}

// 게임 시작 (서버에서 호출)
let game = null;

function startGame(gameData) {
    showScreen('gameScreen');
    
    // 플레이어 이름 설정
    const room = gameState.currentRoom;
    document.querySelector('#player1HUD .player-name').textContent = 
        room.players[0] ? room.players[0].nickname : 'Player 1';
    document.querySelector('#player2HUD .player-name').textContent = 
        room.players[1] ? room.players[1].nickname : 'Player 2';
    
    // 게임 시작
    game = new Game();
    game.start(gameData);
    
    addSystemMessage('게임이 시작되었습니다!');
}

// 게임 종료
function endGame(result) {
    if (game) {
        game.stop();
        game = null;
    }
    
    showScreen('gameResult');
    
    document.getElementById('resultTitle').textContent = 
        result.winner === gameState.nickname ? '승리!' : '패배!';
    
    document.getElementById('resultMessage').textContent = 
        `승자: ${result.winner}`;
    
    const gameTime = Math.floor(result.gameTime / 1000);
    const minutes = Math.floor(gameTime / 60);
    const seconds = gameTime % 60;
    
    document.getElementById('resultStats').innerHTML = `
        <div>게임 시간: ${minutes}:${seconds.toString().padStart(2, '0')}</div>
        <div>핑: ${gameState.lastPing}ms</div>
    `;
    
    addSystemMessage(`게임 종료: ${result.winner} 승리!`);
}

// 순위 로드
async function loadRankings() {
    const container = document.getElementById('rankingList');
    container.innerHTML = '<div class="loading">순위를 불러오는 중...</div>';
    
    try {
        const response = await fetch('/api/rankings');
        const rankings = await response.json();
        
        if (rankings.length === 0) {
            container.innerHTML = '<div class="no-data">순위 데이터가 없습니다.</div>';
            return;
        }
        
        container.innerHTML = '';
        rankings.forEach(ranking => {
            const rankDiv = document.createElement('div');
            rankDiv.className = 'ranking-item';
            rankDiv.innerHTML = `
                <div>${ranking.rank}</div>
                <div>${escapeHtml(ranking.nickname)}</div>
                <div>${ranking.wins}</div>
            `;
            container.appendChild(rankDiv);
        });
    } catch (error) {
        container.innerHTML = '<div class="error">순위를 불러올 수 없습니다.</div>';
        console.error('순위 로드 실패:', error);
    }
}

// 유틸리티 함수들
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', () => {
    // 로딩 스크린 숨기기
    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
    }, 1000);
    
    // Socket.IO 초기화
    initializeSocket();
    
    // 기본 이벤트 리스너들
    document.getElementById('setNickname').addEventListener('click', setNickname);
    document.getElementById('nickname').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setNickname();
    });
    
    // 메뉴 버튼들
    document.getElementById('joinRoomBtn').addEventListener('click', () => {
        if (!gameState.nickname) {
            showError('먼저 닉네임을 설정해주세요.');
            return;
        }
        showScreen('roomList');
        loadRooms();
    });
    
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        if (!gameState.nickname) {
            showError('먼저 닉네임을 설정해주세요.');
            return;
        }
        showScreen('createRoom');
    });
    
    document.getElementById('rankingBtn').addEventListener('click', () => {
        showScreen('ranking');
        loadRankings();
    });
    
    // 뒤로가기 버튼들
    document.getElementById('backFromRooms').addEventListener('click', () => showScreen('mainMenu'));
    document.getElementById('backFromCreate').addEventListener('click', () => showScreen('mainMenu'));
    document.getElementById('backFromRanking').addEventListener('click', () => showScreen('mainMenu'));
    document.getElementById('backToMenuBtn').addEventListener('click', () => {
        socket.emit('leaveRoom');
        showScreen('mainMenu');
    });
    
    // 방 관련 버튼들
    document.getElementById('refreshRooms').addEventListener('click', loadRooms);
    document.getElementById('createRoomBtn2').addEventListener('click', createRoom);
    document.getElementById('readyBtn').addEventListener('click', toggleReady);
    document.getElementById('startGameBtn').addEventListener('click', startGameAsHost);
    document.getElementById('leaveRoomBtn').addEventListener('click', () => {
        socket.emit('leaveRoom');
        showScreen('mainMenu');
    });
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        showScreen('waitingRoom');
    });
    
    // 캐릭터 선택
    document.querySelectorAll('.character').forEach(char => {
        char.addEventListener('click', () => {
            document.querySelectorAll('.character').forEach(c => c.classList.remove('selected'));
            char.classList.add('selected');
            gameState.selectedCharacter = parseInt(char.dataset.char);
        });
    });
    
    // 대기실 캐릭터 변경
    document.getElementById('characterSelect').addEventListener('change', changeCharacter);
    
    // 채팅 시스템
    document.getElementById('sendChat').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // 채팅 탭 전환
    document.querySelectorAll('.chat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            gameState.chatMode = tab.dataset.tab;
        });
    });
    
    // 에러 알림 닫기
    document.getElementById('closeError').addEventListener('click', () => {
        document.getElementById('errorNotification').classList.add('hidden');
    });
});
