const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 게임 데이터 저장
let gameRooms = new Map();
let playerRankings = {};

// 랭킹 데이터 로드/저장
function loadRankings() {
    try {
        if (fs.existsSync('rankings.json')) {
            const data = fs.readFileSync('rankings.json', 'utf8');
            playerRankings = JSON.parse(data);
        }
    } catch (error) {
        console.error('랭킹 로드 실패:', error);
        playerRankings = {};
    }
}

function saveRankings() {
    try {
        fs.writeFileSync('rankings.json', JSON.stringify(playerRankings, null, 2));
    } catch (error) {
        console.error('랭킹 저장 실패:', error);
    }
}

// 서버 시작시 랭킹 로드
loadRankings();

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 랭킹 API
app.get('/api/rankings', (req, res) => {
    const sortedRankings = Object.entries(playerRankings)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([nickname, wins], index) => ({
            rank: index + 1,
            nickname,
            wins
        }));
    
    res.json(sortedRankings);
});

app.post('/api/rankings', (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ error: '닉네임이 필요합니다.' });
    }
    
    if (!playerRankings[nickname]) {
        playerRankings[nickname] = 0;
    }
    playerRankings[nickname]++;
    saveRankings();
    
    res.json({ success: true, wins: playerRankings[nickname] });
});

// 방 목록 API
app.get('/api/rooms', (req, res) => {
    const rooms = Array.from(gameRooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        players: `${room.players.length}/2`,
        isFull: room.players.length >= 2
    }));
    
    res.json(rooms);
});

// Socket.IO 연결 처리
let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    console.log('플레이어 연결:', socket.id, '(총', onlineUsers, '명)');
    
    // 온라인 유저 수 브로드캐스트
    io.emit('onlineCount', onlineUsers);
    
    let currentPlayer = {
        id: socket.id,
        nickname: '',
        room: null,
        character: 1,
        ready: false
    };

    // 핑-퐁
    socket.on('ping', (timestamp) => {
        socket.emit('pong', timestamp);
    });

    // 닉네임 설정
    socket.on('setNickname', (nickname) => {
        currentPlayer.nickname = nickname;
        socket.emit('nicknameSet', { success: true, nickname });
        
        // 시스템 메시지 전송
        socket.emit('systemMessage', `${nickname}님이 입장하셨습니다.`);
    });

    // 방 생성
    socket.on('createRoom', (data) => {
        const roomId = Date.now().toString();
        const room = {
            id: roomId,
            name: data.roomName,
            host: socket.id,
            players: [currentPlayer],
            gameState: 'waiting',
            gameData: {
                player1: { health: 100, bullets: 3, x: 100, y: 300, char: 1 },
                player2: { health: 70, bullets: 3, x: 700, y: 300, char: 2 }
            }
        };
        
        gameRooms.set(roomId, room);
        currentPlayer.room = roomId;
        currentPlayer.character = data.character;
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, room });
        socket.emit('roomUpdate', room);
        
        // 전체에게 방 목록 업데이트 알림
        io.emit('roomListUpdate');
    });

    // 방 입장
    socket.on('joinRoom', (roomId) => {
        const room = gameRooms.get(roomId);
        
        if (!room) {
            socket.emit('error', '존재하지 않는 방입니다.');
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('error', '방이 가득 찼습니다.');
            return;
        }
        
        room.players.push(currentPlayer);
        currentPlayer.room = roomId;
        
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, room });
        
        // 방의 모든 플레이어에게 업데이트 전송
        io.to(roomId).emit('roomUpdate', room);
        
        // 전체에게 방 목록 업데이트 알림
        io.emit('roomListUpdate');
    });

    // 방 나가기
    socket.on('leaveRoom', () => {
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);
                
                if (room.players.length === 0) {
                    // 방이 비었으면 삭제
                    gameRooms.delete(currentPlayer.room);
                } else {
                    // 호스트가 나갔으면 다른 플레이어를 호스트로
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                    }
                    io.to(currentPlayer.room).emit('roomUpdate', room);
                }
                
                socket.leave(currentPlayer.room);
                io.emit('roomListUpdate');
            }
            currentPlayer.room = null;
        }
    });

    // 준비 상태 토글
    socket.on('toggleReady', () => {
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.ready = !player.ready;
                    io.to(currentPlayer.room).emit('roomUpdate', room);
                }
            }
        }
    });

    // 캐릭터 변경
    socket.on('changeCharacter', (character) => {
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                if (player) {
                    player.character = character;
                    io.to(currentPlayer.room).emit('roomUpdate', room);
                }
            }
        }
        currentPlayer.character = character;
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room && room.host === socket.id && room.players.length === 2) {
                // 모든 플레이어가 준비되었는지 확인
                const allReady = room.players.every(p => p.ready);
                if (!allReady) {
                    socket.emit('error', '모든 플레이어가 준비되지 않았습니다.');
                    return;
                }
                
                room.gameState = 'playing';
                room.startTime = Date.now();
                
                // 플레이어 캐릭터 설정
                room.gameData.player1.char = room.players[0].character;
                room.gameData.player2.char = room.players[1].character;
                
                // 체력 설정
                room.gameData.player1.health = room.players[0].character === 1 ? 100 : 70;
                room.gameData.player2.health = room.players[1].character === 1 ? 100 : 70;
                
                // 위치 초기화
                room.gameData.player1.x = 100;
                room.gameData.player1.y = 300;
                room.gameData.player2.x = 700;
                room.gameData.player2.y = 300;
                
                // 총알 초기화
                room.gameData.player1.bullets = 3;
                room.gameData.player2.bullets = 3;
                
                io.to(currentPlayer.room).emit('gameStart', room.gameData);
            }
        }
    });

    // 게임 액션 (이동, 공격 등)
    socket.on('gameAction', (action) => {
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room && room.gameState === 'playing') {
                // 액션 처리 및 게임 상태 업데이트
                processGameAction(room, socket.id, action);
                
                // 방의 모든 플레이어에게 게임 상태 전송
                io.to(currentPlayer.room).emit('gameUpdate', room.gameData);
            }
        }
    });

    // 채팅 메시지
    socket.on('chatMessage', (data) => {
        const message = {
            sender: currentPlayer.nickname,
            content: data.message,
            type: data.type, // 'all' 또는 'room'
            timestamp: Date.now()
        };
        
        if (currentPlayer.room && data.type === 'room') {
            // 방 채팅은 같은 방의 다른 플레이어들에게만
            socket.to(currentPlayer.room).emit('chatMessage', message);
        } else {
            // 전체 채팅은 모든 연결된 클라이언트에게
            socket.broadcast.emit('chatMessage', message);
        }
    });

    // 연결 해제
    socket.on('disconnect', () => {
        onlineUsers--;
        console.log('플레이어 연결 해제:', socket.id, '(총', onlineUsers, '명)');
        
        // 온라인 유저 수 업데이트
        io.emit('onlineCount', onlineUsers);
        
        // 방에서 나가기 처리
        if (currentPlayer.room) {
            const room = gameRooms.get(currentPlayer.room);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);
                
                if (room.players.length === 0) {
                    gameRooms.delete(currentPlayer.room);
                } else {
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                    }
                    io.to(currentPlayer.room).emit('roomUpdate', room);
                    io.to(currentPlayer.room).emit('systemMessage', 
                        `${currentPlayer.nickname}님이 나가셨습니다.`);
                }
                
                io.emit('roomListUpdate');
            }
        }
    });
});

// 게임 액션 처리 함수
function processGameAction(room, playerId, action) {
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    
    const playerKey = `player${playerIndex + 1}`;
    const player = room.gameData[playerKey];
    const otherPlayerKey = playerIndex === 0 ? 'player2' : 'player1';
    const otherPlayer = room.gameData[otherPlayerKey];
    
    switch (action.type) {
        case 'move':
            const speed = player.char === 1 ? 10 : 15;
            player.x = Math.max(25, Math.min(775, player.x + action.dx * speed));
            player.y = Math.max(25, Math.min(575, player.y + action.dy * speed));
            break;
            
        case 'attack':
            if (player.bullets > 0) {
                player.bullets--;
                
                let damage = 0;
                let hit = false;
                
                if (player.char === 1) {
                    // 애새이 1호 - 원거리 공격 (데미지: 15)
                    damage = 15;
                    
                    // 원거리 공격 충돌 검사
                    const maxRange = 400; // 최대 사거리
                    const bulletPath = Math.min(
                        maxRange, 
                        Math.sqrt(Math.pow(action.mouseX - player.x, 2) + Math.pow(action.mouseY - player.y, 2))
                    );
                    
                    // 총알 경로에서 충돌 검사
                    const steps = 20;
                    for (let i = 1; i <= steps; i++) {
                        const progress = (i / steps) * (bulletPath / maxRange);
                        const bulletX = player.x + (action.mouseX - player.x) * progress;
                        const bulletY = player.y + (action.mouseY - player.y) * progress;
                        
                        const distToOther = Math.sqrt(
                            Math.pow(bulletX - otherPlayer.x, 2) + 
                            Math.pow(bulletY - otherPlayer.y, 2)
                        );
                        
                        if (distToOther <= 30) { // 충돌 판정 크기
                            hit = true;
                            io.to(room.id).emit('attackHit', {
                                x: otherPlayer.x,
                                y: otherPlayer.y,
                                attacker: playerKey,
                                target: otherPlayerKey
                            });
                            break;
                        }
                    }
                } else {
                    // 애새이 2호 - 돌진 공격 (데미지: 12)
                    damage = 12;
                    
                    const dashDistance = 50; // 돌진 거리
                    const oldX = player.x;
                    const oldY = player.y;
                    
                    // 돌진 실행
                    player.x = Math.max(25, Math.min(775, player.x + action.dx * dashDistance));
                    player.y = Math.max(25, Math.min(575, player.y + action.dy * dashDistance));
                    
                    // 돌진 경로에서 충돌 검사
                    const steps = 25;
                    for (let i = 1; i <= steps; i++) {
                        const progress = i / steps;
                        const dashX = oldX + (player.x - oldX) * progress;
                        const dashY = oldY + (player.y - oldY) * progress;
                        
                        const distToOther = Math.sqrt(
                            Math.pow(dashX - otherPlayer.x, 2) + 
                            Math.pow(dashY - otherPlayer.y, 2)
                        );
                        
                        if (distToOther <= 35) {
                            hit = true;
                            io.to(room.id).emit('attackHit', {
                                x: otherPlayer.x,
                                y: otherPlayer.y,
                                attacker: playerKey,
                                target: otherPlayerKey
                            });
                            break;
                        }
                    }
                }
                
                // 히트했을 때만 데미지 적용
                if (hit) {
                    otherPlayer.health = Math.max(0, otherPlayer.health - damage);
                    
                    // 피격 효과 전송
                    io.to(room.id).emit('playerHit', {
                        target: otherPlayerKey,
                        damage: damage
                    });
                }
                
                // 특수 공격 체크
                if (player.bullets === 0) {
                    setTimeout(() => {
                        let specialDamage = 0;
                        let specialHit = false;
                        
                        if (player.char === 1) {
                            // 애새이 1호 특수공격 - 강력한 돌진 (데미지: 40)
                            specialDamage = 40;
                            const dashDistance = 80;
                            const oldX = player.x;
                            const oldY = player.y;
                            
                            player.x = Math.max(25, Math.min(775, player.x + action.dx * dashDistance));
                            player.y = Math.max(25, Math.min(575, player.y + action.dy * dashDistance));
                            
                            // 특수 돌진 충돌 검사
                            const steps = 30;
                            for (let i = 1; i <= steps; i++) {
                                const progress = i / steps;
                                const dashX = oldX + (player.x - oldX) * progress;
                                const dashY = oldY + (player.y - oldY) * progress;
                                
                                const distToOther = Math.sqrt(
                                    Math.pow(dashX - otherPlayer.x, 2) + 
                                    Math.pow(dashY - otherPlayer.y, 2)
                                );
                                
                                if (distToOther <= 40) {
                                    specialHit = true;
                                    // 넉백 효과
                                    const knockbackDistance = 60;
                                    otherPlayer.x = Math.max(25, Math.min(775, 
                                        otherPlayer.x + action.dx * knockbackDistance));
                                    otherPlayer.y = Math.max(25, Math.min(575, 
                                        otherPlayer.y + action.dy * knockbackDistance));
                                    
                                    io.to(room.id).emit('attackHit', {
                                        x: otherPlayer.x,
                                        y: otherPlayer.y,
                                        attacker: playerKey,
                                        target: otherPlayerKey,
                                        special: true
                                    });
                                    break;
                                }
                            }
                        } else {
                            // 애새이 2호 특수공격 - 초고속 돌진 (데미지: 35)
                            specialDamage = 35;
                            const dashDistance = 100;
                            const oldX = player.x;
                            const oldY = player.y;
                            
                            player.x = Math.max(25, Math.min(775, player.x + action.dx * dashDistance));
                            player.y = Math.max(25, Math.min(575, player.y + action.dy * dashDistance));
                            
                            // 특수 돌진 충돌 검사
                            const steps = 35;
                            for (let i = 1; i <= steps; i++) {
                                const progress = i / steps;
                                const dashX = oldX + (player.x - oldX) * progress;
                                const dashY = oldY + (player.y - oldY) * progress;
                                
                                const distToOther = Math.sqrt(
                                    Math.pow(dashX - otherPlayer.x, 2) + 
                                    Math.pow(dashY - otherPlayer.y, 2)
                                );
                                
                                if (distToOther <= 40) {
                                    specialHit = true;
                                    // 상대방을 끌어당긴 후 던지기
                                    const grabDistance = 80;
                                    otherPlayer.x = Math.max(25, Math.min(775, 
                                        player.x - action.dx * grabDistance));
                                    otherPlayer.y = Math.max(25, Math.min(575, 
                                        player.y - action.dy * grabDistance));
                                    
                                    io.to(room.id).emit('attackHit', {
                                        x: otherPlayer.x,
                                        y: otherPlayer.y,
                                        attacker: playerKey,
                                        target: otherPlayerKey,
                                        special: true
                                    });
                                    break;
                                }
                            }
                        }
                        
                        // 특수 공격이 히트했을 때만 데미지 적용
                        if (specialHit) {
                            otherPlayer.health = Math.max(0, otherPlayer.health - specialDamage);
                            
                            // 특수 공격 피격 효과
                            io.to(room.id).emit('playerHit', {
                                target: otherPlayerKey,
                                damage: specialDamage,
                                special: true
                            });
                        }
                        
                        // 게임 종료 체크
                        checkGameEnd(room);
                        
                        // 업데이트 전송
                        io.to(room.id).emit('gameUpdate', room.gameData);
                        io.to(room.id).emit('specialAttack', { 
                            player: playerKey, 
                            damage: specialDamage,
                            hit: specialHit
                        });
                    }, 100);
                }
            }
            break;
            
        case 'reload':
            const reloadTime = player.char === 1 ? 2000 : 3000;
            setTimeout(() => {
                player.bullets = 3;
                io.to(room.id).emit('gameUpdate', room.gameData);
                io.to(room.id).emit('reloadComplete', { player: playerKey });
            }, reloadTime);
            break;
    }
    
    // 게임 종료 체크
    checkGameEnd(room);
}

// 게임 종료 체크
function checkGameEnd(room) {
    const p1 = room.gameData.player1;
    const p2 = room.gameData.player2;
    
    if (p1.health <= 0 || p2.health <= 0) {
        room.gameState = 'finished';
        
        let winner, loser;
        if (p1.health <= 0) {
            winner = room.players[1];
            loser = room.players[0];
        } else {
            winner = room.players[0];
            loser = room.players[1];
        }
        
        // 승자 랭킹 업데이트
        if (!playerRankings[winner.nickname]) {
            playerRankings[winner.nickname] = 0;
        }
        playerRankings[winner.nickname]++;
        saveRankings();
        
        // 게임 결과 전송
        io.to(room.id).emit('gameEnd', {
            winner: winner.nickname,
            loser: loser.nickname,
            gameTime: Date.now() - room.startTime
        });
        
        // 게임 상태 초기화
        setTimeout(() => {
            room.gameState = 'waiting';
            room.gameData = {
                player1: { health: 100, bullets: 3, x: 100, y: 300, char: 1 },
                player2: { health: 70, bullets: 3, x: 700, y: 300, char: 2 }
            };
        }, 5000);
    }
}

// 서버 시작
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`http://localhost:${PORT} 에서 게임을 플레이할 수 있습니다.`);
});
