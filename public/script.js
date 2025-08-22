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
        this.ctx
