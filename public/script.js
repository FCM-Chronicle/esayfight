// 공격 히트 이펙트
    socket.on('attackHit', (data) => {
        if (game) {
            game.attackEffects.push({
                type: 'impact',
                x: data.x,
                y: data.y,
                duration: 800 // 0.8초
            });
        }
    });
    
    // 플레이어 피격 효과
    socket.on('playerHit', (data) => {
        if (game) {
            // 피격된 플레이어를 빨간색으로 변경 (0.3초간)
            game.playerHitEffects[data.target] = 300; // 300ms
            
            // 데미지 텍스트 표시
            const targetPlayer = gameState.gameData[data.target];
            if (targetPlayer) {
                game.attackEffects.push({
                    type: 'damage',
                    x: targetPlayer.x,
                    y: targetPlayer.y - 40,
                    damage: data.damage,
                    special: data.special || false,
                    duration: 1000 // 1초
                });
            }
        }
    });// Socket.IO 연결
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
    // 연결 시도 전 상태 표시
    addSystemMessage('서버에 연결 중...');
    
    // Socket.IO가 로드되었는지 확인
    if (typeof io === 'undefined') {
        addSystemMessage('Socket.IO 라이브러리 로드 실패!');
        showError('네트워크 연결을 확인해주세요.');
        return;
    }
    
    try {
        socket = io({
            timeout: 15000,
            forceNew: true,
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: false
        });
        
        socket.on('connect', () => {
            console.log('서버에 연결됨:', socket.id);
            isConnected = true;
            updateConnectionStatus(true);
            document.getElementById('chatInput').disabled = false;
            document.getElementById('sendChat').disabled = false;
            
            // 연결 성공 메시지
            addSystemMessage('서버에 성공적으로 연결되었습니다!');
        });
        
        socket.on('connect_error', (error) => {
            console.error('연결 오류:', error);
            addSystemMessage('서버 연결 오류: ' + error.message);
            showError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
            
            // 서버가 아직 시작 중일 수 있으므로 재시도
            setTimeout(() => {
                addSystemMessage('연결을 다시 시도합니다...');
                socket.connect();
            }, 5000);
        });
        
        socket.on('disconnect', (reason) => {
            console.log('서버 연결 끊김:', reason);
            isConnected = false;
            updateConnectionStatus(false);
            document.getElementById('chatInput').disabled = true;
            document.getElementById('sendChat').disabled = true;
            
            addSystemMessage('서버 연결이 끊어졌습니다: ' + reason);
            
            // 자동 재연결 시도
            if (reason !== 'io client disconnect') {
                addSystemMessage('5초 후 재연결을 시도합니다...');
                setTimeout(() => {
                    socket.connect();
                }, 5000);
            }
        });
        
    } catch (error) {
        console.error('Socket 초기화 오류:', error);
        addSystemMessage('Socket 초기화 실패: ' + error.message);
        showError('게임 초기화에 실패했습니다.');
    }
    
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
        
        // 특수 공격 텍스트 이펙트 표시
        if (game) {
            game.specialAttackText = {
                duration: 2000 // 2초간 표시
            };
        }
    });
    
    // 공격 히트 이펙트
    socket.on('attackHit', (data) => {
        if (game) {
            game.attackEffects.push({
                type: 'impact',
                x: data.x,
                y: data.y,
                duration: 800 // 0.8초
            });
        }
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
        this.attackEffects = []; // 공격 이펙트 배열
        this.specialAttackText = null; // 특수 공격 텍스트
        this.playerHitEffects = {}; // 플레이어 피격 효과
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
            const normalizedDx = dx / distance;
            const normalizedDy = dy / distance;
            
            // 공격 이펙트 추가
            if (player.char === 1) {
                // 애새이 1호 - 원거리 공격 이펙트
                this.attackEffects.push({
                    type: 'bullet',
                    startX: player.x,
                    startY: player.y,
                    endX: this.mouse.x,
                    endY: this.mouse.y,
                    color: '#4b96ff',
                    duration: 500 // 0.5초
                });
            } else {
                // 애새이 2호 - 돌진 공격 이펙트
                const dashDistance = 30; // 6배 증가 (5 -> 30)
                const endX = Math.max(25, Math.min(775, player.x + normalizedDx * dashDistance));
                const endY = Math.max(25, Math.min(575, player.y + normalizedDy * dashDistance));
                
                this.attackEffects.push({
                    type: 'dash',
                    startX: player.x,
                    startY: player.y,
                    endX: endX,
                    endY: endY,
                    color: '#ff4b4b',
                    duration: 300 // 0.3초
                });
            }
            
            socket.emit('gameAction', {
                type: 'attack',
                dx: normalizedDx,
                dy: normalizedDy,
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
        // 피격 효과 확인
        const playerKey = `player${number}`;
        const isHit = this.playerHitEffects[playerKey] && this.playerHitEffects[playerKey] > 0;
        const currentColor = isHit ? '#ff0000' : color; // 피격시 빨간색
        
        // 플레이어 그림자
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.beginPath();
        this.ctx.ellipse(player.x + 2, player.y + 27, 23, 8, 0, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 플레이어 몸체
        this.ctx.fillStyle = currentColor;
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
        
        // 피격 효과 시간 감소
        if (isHit) {
            this.playerHitEffects[playerKey] -= 16; // 60fps 기준
            if (this.playerHitEffects[playerKey] <= 0) {
                delete this.playerHitEffects[playerKey];
            }
        }
    }
    
    renderEffects() {
        // 공격 이펙트 렌더링
        if (this.attackEffects && this.attackEffects.length > 0) {
            this.attackEffects.forEach((effect, index) => {
                this.ctx.save();
                
                if (effect.type === 'bullet') {
                    // 총알 궤적 이펙트
                    this.ctx.strokeStyle = effect.color;
                    this.ctx.lineWidth = 3;
                    this.ctx.beginPath();
                    this.ctx.moveTo(effect.startX, effect.startY);
                    this.ctx.lineTo(effect.endX, effect.endY);
                    this.ctx.stroke();
                    
                    // 총알 끝점에 작은 폭발
                    this.ctx.fillStyle = effect.color;
                    this.ctx.beginPath();
                    this.ctx.arc(effect.endX, effect.endY, 5, 0, Math.PI * 2);
                    this.ctx.fill();
                } else if (effect.type === 'dash') {
                    // 돌진 궤적 이펙트
                    this.ctx.strokeStyle = effect.color;
                    this.ctx.lineWidth = 8;
                    this.ctx.beginPath();
                    this.ctx.moveTo(effect.startX, effect.startY);
                    this.ctx.lineTo(effect.endX, effect.endY);
                    this.ctx.stroke();
                    
                    // 돌진 잔상 효과
                    for (let i = 0; i < 5; i++) {
                        const progress = i / 5;
                        const x = effect.startX + (effect.endX - effect.startX) * progress;
                        const y = effect.startY + (effect.endY - effect.startY) * progress;
                        this.ctx.fillStyle = `rgba(${effect.color === '#ff6b6b' ? '255, 107, 107' : '75, 150, 255'}, ${0.3 - progress * 0.3})`;
                        this.ctx.beginPath();
                        this.ctx.arc(x, y, 15 - i * 2, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                } else if (effect.type === 'impact') {
                    // 충돌 이펙트
                    const radius = 20 + Math.sin(Date.now() * 0.02) * 5;
                    this.ctx.strokeStyle = '#ff0000';
                    this.ctx.lineWidth = 4;
                    this.ctx.beginPath();
                    this.ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
                    this.ctx.stroke();
                    
                    // 별 모양 충격파
                    this.ctx.fillStyle = '#ffff00';
                    for (let i = 0; i < 8; i++) {
                        const angle = (i * Math.PI * 2) / 8;
                        const x = effect.x + Math.cos(angle) * radius;
                        const y = effect.y + Math.sin(angle) * radius;
                        this.ctx.beginPath();
                        this.ctx.arc(x, y, 3, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                } else if (effect.type === 'damage') {
                    // 데미지 텍스트 이펙트
                    const progress = 1 - (effect.duration / 1000);
                    const yOffset = progress * 30; // 위로 올라감
                    const alpha = 1 - progress; // 페이드 아웃
                    
                    this.ctx.textAlign = 'center';
                    this.ctx.font = effect.special ? 'bold 24px Arial' : 'bold 18px Arial';
                    this.ctx.fillStyle = effect.special ? 
                        `rgba(255, 0, 255, ${alpha})` : `rgba(255, 100, 100, ${alpha})`;
                    this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                    this.ctx.lineWidth = 1;
                    
                    this.ctx.strokeText(`-${effect.damage}`, effect.x, effect.y - yOffset);
                    this.ctx.fillText(`-${effect.damage}`, effect.x, effect.y - yOffset);
                }
                
                this.ctx.restore();
                
                // 이펙트 지속시간 감소
                effect.duration -= 16; // 60fps 기준
                if (effect.duration <= 0) {
                    this.attackEffects.splice(index, 1);
                }
            });
        }
        
        // 특수 공격 텍스트 이펙트
        if (this.specialAttackText && this.specialAttackText.duration > 0) {
            this.ctx.save();
            
            const progress = 1 - (this.specialAttackText.duration / 2000); // 2초 동안
            const scale = 1 + Math.sin(progress * Math.PI * 4) * 0.2; // 펄스 효과
            const alpha = progress < 0.8 ? 1 : (1 - progress) * 5; // 페이드 아웃
            
            this.ctx.textAlign = 'center';
            this.ctx.font = `bold ${40 * scale}px Arial`;
            this.ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            this.ctx.lineWidth = 2;
            
            // 그림자 효과
            this.ctx.shadowColor = 'black';
            this.ctx.shadowBlur = 10;
            this.ctx.shadowOffsetX = 2;
            this.ctx.shadowOffsetY = 2;
            
            this.ctx.strokeText('궁극기!', this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.fillText('궁극기!', this.canvas.width / 2, this.canvas.height / 2);
            
            this.ctx.restore();
            
            this.specialAttackText.duration -= 16;
            if (this.specialAttackText.duration <= 0) {
                this.specialAttackText = null;
            }
        }
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
