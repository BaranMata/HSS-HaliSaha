const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'hssdb-a136a.firebasestorage.app'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
console.log("HSS Veritabanı bağlantısı başarılı!");

const app = express();

// --- GÜVENLİK VE AYARLAR ---
app.use(cors());
app.use(express.json());

// --- STATİK DOSYA SUNUCUSU (EN YUKARIDA OLMALI) ---
// Mobil uygulamanın videolara URL üzerinden erişebilmesi için
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = 3000;

// --- UPLOADS KLASÖRÜ VE MULTER AYARLARI ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); 
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'hss-video-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==========================================
// --- FIREBASE AUTH MIDDLEWARE (GÜVENLİK) ---
// ==========================================
// SDD 3.3: Veri Güvenliği - Firebase Auth Token doğrulaması
// Bu middleware, gelen isteklerdeki Firebase ID Token'ını doğrular.
// Korumalı endpoint'lere erişmeden önce kullanıcının kimliği teyit edilir.

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Yetkilendirme başarısız. Token bulunamadı." });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Doğrulanmış kullanıcı bilgisini req'e ekle
        next();
    } catch (error) {
        console.error("Token doğrulama hatası:", error.message);
        return res.status(403).json({ error: "Geçersiz veya süresi dolmuş token." });
    }
};

// ==========================================
// --- API UÇ NOKTALARI (ENDPOINTS) ---
// ==========================================

// 1. Kullanıcı Kayıt (Register)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { uid, fullName, username, position } = req.body;
        if (!uid || !username) return res.status(400).send({ error: "UID ve Username zorunludur!" });

        await db.collection('USERS').doc(uid).set({
            UserID: uid,
            fullName: fullName || '',
            Username: username,
            Skill_Rating: 0,
            Position: position || "Belirtilmedi",
            bio: '',
            matchesPlayed: 0,
            goals: 0,
            assists: 0
        });
        res.status(201).send({ message: "Kullanıcı başarıyla oluşturuldu!", uid: uid });
    } catch (error) {
        res.status(500).send({ error: "Kayıt işlemi sırasında hata oluştu." });
    }
});

// 1b. Kullanıcı Profili Getir
app.get('/api/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const userDoc = await db.collection('USERS').doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "Kullanıcı bulunamadı!" });
        }

        res.status(200).json({ user: userDoc.data() });
    } catch (error) {
        console.error("Kullanıcı getirme hatası:", error);
        res.status(500).json({ error: "Kullanıcı bilgileri getirilemedi." });
    }
});

// 1c. Kullanıcı Profili Güncelle
app.post('/api/users/update', async (req, res) => {
    try {
        const { userId, fullName, username, position, bio } = req.body;
        if (!userId) return res.status(400).json({ error: "Kullanıcı ID gerekli!" });

        const updateData = {};
        if (fullName !== undefined) updateData.fullName = fullName;
        if (username !== undefined) updateData.Username = username;
        if (position !== undefined) updateData.Position = position;
        if (bio !== undefined) updateData.bio = bio;

        await db.collection('USERS').doc(userId).set(updateData, { merge: true });
        res.status(200).json({ message: "Profil güncellendi!" });
    } catch (error) {
        console.error("Profil güncelleme hatası:", error);
        res.status(500).json({ error: "Profil güncellenemedi." });
    }
});

// 2. İlan Oluşturma (Create Match) - GÜNCELLENDİ (matchTime Eklendi)
app.post('/api/matches/create', async (req, res) => {
    try {
        // req.body içinden matchTime verisini de çekiyoruz
        const { organizerId, latitude, longitude, requiredPosition, matchTime } = req.body;
        
        // Eksik bilgi kontrolüne matchTime'ı da dahil ettik
        if (!organizerId || !latitude || !longitude || !requiredPosition || !matchTime) {
            return res.status(400).send({ error: "Eksik bilgi! Lütfen tüm alanları doldurun." });
        }

        const newMatchRef = db.collection('MATCH').doc();
        await newMatchRef.set({
            MatchID: newMatchRef.id,
            OrganizerID: organizerId,
            Latitude: latitude,
            Longitude: longitude,
            Required_Position: requiredPosition,
            matchTime: matchTime, // SAAT BİLGİSİ FİRESTORE'A YAZILIYOR
            Status: "Aktif",
            CreatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).send({ message: "İlan oluşturuldu!", matchId: newMatchRef.id });
    } catch (error) {
        res.status(500).send({ error: "İlan oluşturma hatası." });
    }
});

// 3. İlanları Getir (Get Matches)
app.get('/api/matches/nearby', async (req, res) => {
    try {
        const snapshot = await db.collection('MATCH').get();
        const matches = [];
        snapshot.forEach(doc => matches.push(doc.data()));
        res.status(200).send({ matches: matches });
    } catch (error) {
        res.status(500).send({ error: "İlanlar getirme hatası." });
    }
});

// 4. Maça Başvuru Yap
app.post('/api/applications/apply', async (req, res) => {
  try {
    const { matchId, applicantId } = req.body;
    if (!matchId || !applicantId) return res.status(400).send({ error: "Eksik veri!" });

    const newAppRef = db.collection('APPLICATION').doc();
    await newAppRef.set({
      ApplicationID: newAppRef.id,
      MatchID: matchId,
      ApplicantID: applicantId,
      Status: "Beklemede",
      AppliedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // --- SRS 1.2.3: Başvuru yapıldığında otomatik DM kanalı aç ---
    // İlan sahibini bul
    const matchDoc = await db.collection('MATCH').doc(matchId).get();
    if (matchDoc.exists) {
        const organizerId = matchDoc.data().OrganizerID;
        // İki kullanıcı arasında tekil bir sohbet odası ID'si oluştur
        const chatRoomId = [organizerId, applicantId].sort().join('_');

        // Sohbet odası zaten yoksa oluştur
        const chatRoomRef = db.collection('CHATROOMS').doc(chatRoomId);
        const chatRoomDoc = await chatRoomRef.get();
        if (!chatRoomDoc.exists) {
            await chatRoomRef.set({
                chatRoomId: chatRoomId,
                participants: [organizerId, applicantId],
                matchId: matchId,
                lastMessage: 'Yeni başvuru! Sohbet başlatıldı.',
                lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    }

    res.status(201).send({ message: "Başvuru alındı!", applicationId: newAppRef.id });
  } catch (error) {
    res.status(500).send({ error: "Başvuru hatası." });
  }
});

// 5. Başvuruyu Yanıtla
app.post('/api/applications/respond', async (req, res) => {
  try {
    const { applicationId, status } = req.body;
    if (!applicationId || !status) return res.status(400).send({ error: "Eksik veri!" });

    await db.collection('APPLICATION').doc(applicationId).update({
      Status: status,
      UpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).send({ message: "Durum güncellendi!" });
  } catch (error) {
    res.status(500).send({ error: "Yanıt hatası." });
  }
});

// 6. Oyuncu Puanlama
app.post('/api/users/rate', async (req, res) => {
  try {
    const { targetUserId, rating } = req.body;
    if (!targetUserId || rating === undefined) return res.status(400).send({ error: "Eksik veri!" });

    await db.collection('USERS').doc(targetUserId).update({
      Skill_Rating: admin.firestore.FieldValue.increment(rating)
    });
    res.status(200).send({ message: "Puanlandı!" });
  } catch (error) {
    res.status(500).send({ error: "Puanlama hatası." });
  }
});

// 7. VİDEO YÜKLEME UCU (Firebase Storage + Firestore Bağlantılı)
// SDD 4.3.3.4: Videolar bulut depolama alanında saklanır
app.post('/api/media/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Video bulunamadı.' });
    }

    try {
        const username = req.body.username || '@oyuncu';
        const description = req.body.description || 'Sahalara dönüş! ⚽';

        let videoUrl;

        // Firebase Storage'a yükleme dene
        try {
            const localFilePath = req.file.path;
            const destFileName = `videos/${req.file.filename}`;

            await bucket.upload(localFilePath, {
                destination: destFileName,
                metadata: {
                    contentType: req.file.mimetype,
                    metadata: {
                        uploadedBy: username,
                        description: description
                    }
                }
            });

            // Dosyayı herkese açık yap ve URL'yi al
            const file = bucket.file(destFileName);
            await file.makePublic();
            videoUrl = `https://storage.googleapis.com/${bucket.name}/${destFileName}`;

            // Yerel dosyayı sil (buluta yüklendi, artık gereksiz)
            fs.unlinkSync(localFilePath);
            console.log("Video Firebase Storage'a yüklendi:", videoUrl);

        } catch (storageError) {
            // Firebase Storage başarısız olursa yerel URL'yi kullan (fallback)
            console.warn("Firebase Storage yüklenemedi, yerel depolama kullanılıyor:", storageError.message);
            videoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        }

        const yeniVideoId = Date.now().toString();
        const yeniVideoVerisi = {
            id: yeniVideoId,
            username: username,
            ownerId: req.body.ownerId || 'unknown',
            description: description,
            videoUrl: videoUrl,
            likes: 0,
            comments: 0,
            UploadedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // --- FİREBASE'E KAYIT ---
        await db.collection('MEDIA').doc(yeniVideoId).set(yeniVideoVerisi);

        console.log("Firestore'a yeni video mühürlendi:", videoUrl);
        res.status(200).json({ message: 'Efsane! Video başarıyla yüklendi.', video: yeniVideoVerisi });

    } catch (error) {
        console.error("Firestore Kayıt Hatası:", error);
        res.status(500).json({ error: "Video yüklendi ama veritabanına kaydedilemedi." });
    }
});

// 8. REELS AKIŞI UCU (Firestore'dan Canlı Veri)
app.get('/api/media/feed', async (req, res) => {
    try {
        // MEDIA koleksiyonundan en yeni 10 videoyu çek
        const snapshot = await db.collection('MEDIA')
            .orderBy('UploadedAt', 'desc')
            .limit(10)
            .get();

        const videolar = [];
        snapshot.forEach(doc => {
            videolar.push(doc.data());
        });

        res.status(200).json({ videos: videolar });

    } catch (error) {
        console.error("Firestore Veri Çekme Hatası:", error);
        res.status(500).json({ error: "Akış getirilirken bir hata oluştu." });
    }
});

// ==========================================
// --- SOSYAL ETKİLEŞİM API'LERİ ---
// ==========================================

// 9. Videoyu Beğen (Like)
app.post('/api/media/like', async (req, res) => {
    try {
        const { videoId } = req.body;
        if (!videoId) return res.status(400).send({ error: "Video ID gerekli!" });

        await db.collection('MEDIA').doc(videoId).update({
            likes: admin.firestore.FieldValue.increment(1)
        });
        res.status(200).send({ message: "Beğeni kaydedildi!" });
    } catch (error) {
        console.error("Beğeni hatası:", error);
        res.status(500).send({ error: "Beğeni işlemi başarısız." });
    }
});

// 10. Yorum Yap (Comment) + Bildirim Oluştur
app.post('/api/media/comment', async (req, res) => {
    try {
        const { videoId, username, text } = req.body;
        if (!videoId || !text) return res.status(400).send({ error: "Eksik veri gönderildi!" });

        await db.collection('MEDIA').doc(videoId).collection('COMMENTS').add({
            username: username || "@oyuncu",
            text: text,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await db.collection('MEDIA').doc(videoId).update({
            comments: admin.firestore.FieldValue.increment(1)
        });

        // --- BİLDİRİM: Video sahibine bildirim gönder ---
        try {
            const videoDoc = await db.collection('MEDIA').doc(videoId).get();
            if (videoDoc.exists) {
                const videoOwner = videoDoc.data().ownerId || videoDoc.data().username;
                if (videoOwner && videoOwner !== username) {
                    await db.collection('NOTIFICATIONS').add({
                        recipientId: videoOwner,
                        type: 'comment',
                        message: `${username} videonuza yorum yaptı: "${text.substring(0, 50)}"`,
                        videoId: videoId,
                        isRead: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        } catch (notifError) {
            console.warn("Bildirim oluşturulamadı:", notifError.message);
        }

        res.status(201).send({ message: "Yorum eklendi!" });
    } catch (error) {
        console.error("Yorum hatası:", error);
        res.status(500).send({ error: "Yorum kaydedilemedi." });
    }
});

// 11. Yorumları Getir
app.get('/api/media/comments/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const snapshot = await db.collection('MEDIA').doc(videoId).collection('COMMENTS').orderBy('createdAt', 'asc').get();
        
        const comments = [];
        snapshot.forEach(doc => comments.push(doc.data()));
        
        res.status(200).send({ comments: comments });
    } catch (error) {
        console.error("Yorum çekme hatası:", error);
        res.status(500).send({ error: "Yorumlar getirilemedi." });
    }
});

// 11b. Kullanıcının Kendi Videolarını Getir
app.get('/api/media/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const snapshot = await db.collection('MEDIA')
            .where('username', '==', username)
            .orderBy('UploadedAt', 'desc')
            .get();

        const videos = [];
        snapshot.forEach(doc => videos.push(doc.data()));

        res.status(200).json({ videos: videos });
    } catch (error) {
        console.error("Kullanıcı videoları hatası:", error);
        res.status(500).json({ error: "Videolar getirilemedi." });
    }
});

// 11c. Video Sil
app.delete('/api/media/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        
        // Önce videonun bilgilerini al (Storage'dan da silmek için)
        const videoDoc = await db.collection('MEDIA').doc(videoId).get();
        if (!videoDoc.exists) {
            return res.status(404).json({ error: "Video bulunamadı!" });
        }

        // Firebase Storage'dan silmeyi dene
        try {
            const videoData = videoDoc.data();
            if (videoData.videoUrl && videoData.videoUrl.includes('storage.googleapis.com')) {
                const fileName = videoData.videoUrl.split('/').pop();
                await bucket.file(`videos/${fileName}`).delete();
            }
        } catch (storageErr) {
            console.warn("Storage'dan silinemedi:", storageErr.message);
        }

        // Alt koleksiyon (yorumlar) sil
        const commentsSnapshot = await db.collection('MEDIA').doc(videoId).collection('COMMENTS').get();
        const batch = db.batch();
        commentsSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // Ana dokümanı sil
        await db.collection('MEDIA').doc(videoId).delete();

        res.status(200).json({ message: "Video silindi!" });
    } catch (error) {
        console.error("Video silme hatası:", error);
        res.status(500).json({ error: "Video silinemedi." });
    }
});

// 11d. Bildirimleri Getir
app.get('/api/notifications/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const snapshot = await db.collection('NOTIFICATIONS')
            .where('recipientId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const notifications = [];
        snapshot.forEach(doc => notifications.push({ id: doc.id, ...doc.data() }));

        res.status(200).json({ notifications: notifications });
    } catch (error) {
        console.error("Bildirim hatası:", error);
        res.status(500).json({ error: "Bildirimler getirilemedi." });
    }
});

// 11e. Bildirimi Okundu Olarak İşaretle
app.post('/api/notifications/read', async (req, res) => {
    try {
        const { notificationId } = req.body;
        await db.collection('NOTIFICATIONS').doc(notificationId).update({ isRead: true });
        res.status(200).json({ message: "Bildirim okundu." });
    } catch (error) {
        res.status(500).json({ error: "Bildirim güncellenemedi." });
    }
});

// ==========================================
// --- MESAJLAŞMA API'LERİ (SRS 1.2.3) ---
// ==========================================
// SDD 4.3.3.3: Gerçek zamanlı mesajlaşma - Firestore tabanlı

// 12. Mesaj Gönder
app.post('/api/messages/send', async (req, res) => {
    try {
        const { chatRoomId, senderId, text } = req.body;
        if (!chatRoomId || !senderId || !text) {
            return res.status(400).json({ error: "Eksik veri! chatRoomId, senderId ve text gerekli." });
        }

        // Mesajı CHATROOMS alt koleksiyonuna ekle
        await db.collection('CHATROOMS').doc(chatRoomId).collection('MESSAGES').add({
            senderId: senderId,
            text: text,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Son mesajı sohbet odasında güncelle
        await db.collection('CHATROOMS').doc(chatRoomId).update({
            lastMessage: text,
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(201).json({ message: "Mesaj gönderildi!" });
    } catch (error) {
        console.error("Mesaj gönderme hatası:", error);
        res.status(500).json({ error: "Mesaj gönderilemedi." });
    }
});

// 13. Mesajları Getir (Belirli bir sohbet odası için)
app.get('/api/messages/:chatRoomId', async (req, res) => {
    try {
        const { chatRoomId } = req.params;
        const snapshot = await db.collection('CHATROOMS').doc(chatRoomId)
            .collection('MESSAGES')
            .orderBy('createdAt', 'asc')
            .limit(50)
            .get();

        const messages = [];
        snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));

        res.status(200).json({ messages: messages });
    } catch (error) {
        console.error("Mesaj çekme hatası:", error);
        res.status(500).json({ error: "Mesajlar getirilemedi." });
    }
});

// 14. Kullanıcının Sohbet Odalarını Getir
app.get('/api/chatrooms/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const snapshot = await db.collection('CHATROOMS')
            .where('participants', 'array-contains', userId)
            .orderBy('lastMessageTime', 'desc')
            .get();

        const chatRooms = [];
        snapshot.forEach(doc => chatRooms.push({ id: doc.id, ...doc.data() }));

        res.status(200).json({ chatRooms: chatRooms });
    } catch (error) {
        console.error("Sohbet odaları çekme hatası:", error);
        res.status(500).json({ error: "Sohbet odaları getirilemedi." });
    }
});

// ==========================================
// --- TAKIM MODÜLLERİ (SDD 5.4, SRS 1.2.5) ---
// ==========================================
// Kemik kadrolar için Teams koleksiyonu ve takımlar arası meydan okuma sistemi

// 15. Takım Oluştur
app.post('/api/teams/create', async (req, res) => {
    try {
        const { captainId, teamName, members } = req.body;
        if (!captainId || !teamName) {
            return res.status(400).json({ error: "Kaptan ID ve takım adı zorunludur!" });
        }

        // Kaptanın zaten bir takımı var mı kontrol et
        const existingTeam = await db.collection('TEAMS')
            .where('captain_uid', '==', captainId)
            .get();
        
        if (!existingTeam.empty) {
            return res.status(409).json({ error: "Zaten bir takımınız var!" });
        }

        const newTeamRef = db.collection('TEAMS').doc();
        const teamData = {
            team_id: newTeamRef.id,
            team_name: teamName,
            captain_uid: captainId,
            members: members || [captainId], // Kaptan varsayılan üye
            wins: 0,
            losses: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await newTeamRef.set(teamData);
        res.status(201).json({ message: "Takım kuruldu!", team: teamData });
    } catch (error) {
        console.error("Takım oluşturma hatası:", error);
        res.status(500).json({ error: "Takım oluşturulamadı." });
    }
});

// 16. Takıma Oyuncu Ekle
app.post('/api/teams/add-member', async (req, res) => {
    try {
        const { teamId, newMemberId } = req.body;
        if (!teamId || !newMemberId) {
            return res.status(400).json({ error: "Takım ID ve oyuncu ID zorunludur!" });
        }

        await db.collection('TEAMS').doc(teamId).update({
            members: admin.firestore.FieldValue.arrayUnion(newMemberId)
        });

        res.status(200).json({ message: "Oyuncu kadroya eklendi!" });
    } catch (error) {
        console.error("Oyuncu ekleme hatası:", error);
        res.status(500).json({ error: "Oyuncu eklenemedi." });
    }
});

// 17. Takım Bilgilerini Getir
app.get('/api/teams/:teamId', async (req, res) => {
    try {
        const { teamId } = req.params;
        const teamDoc = await db.collection('TEAMS').doc(teamId).get();

        if (!teamDoc.exists) {
            return res.status(404).json({ error: "Takım bulunamadı!" });
        }

        res.status(200).json({ team: teamDoc.data() });
    } catch (error) {
        console.error("Takım bilgisi çekme hatası:", error);
        res.status(500).json({ error: "Takım bilgisi getirilemedi." });
    }
});

// 18. Tüm Takımları Listele
app.get('/api/teams', async (req, res) => {
    try {
        const snapshot = await db.collection('TEAMS').get();
        const teams = [];
        snapshot.forEach(doc => teams.push(doc.data()));

        res.status(200).json({ teams: teams });
    } catch (error) {
        console.error("Takımlar çekme hatası:", error);
        res.status(500).json({ error: "Takımlar getirilemedi." });
    }
});

// 19. Takıma Meydan Okuma (Challenge)
app.post('/api/teams/challenge', async (req, res) => {
    try {
        const { challengerTeamId, targetTeamId, matchTime, latitude, longitude } = req.body;
        if (!challengerTeamId || !targetTeamId || !matchTime) {
            return res.status(400).json({ error: "Eksik veri! Rakip takım ve maç saati zorunludur." });
        }

        // Kendi takımına meydan okuma engeli
        if (challengerTeamId === targetTeamId) {
            return res.status(400).json({ error: "Kendi takımınıza meydan okuyamazsınız!" });
        }

        const newChallengeRef = db.collection('CHALLENGES').doc();
        const challengeData = {
            challengeId: newChallengeRef.id,
            challengerTeamId: challengerTeamId,
            targetTeamId: targetTeamId,
            matchTime: matchTime,
            latitude: latitude || null,
            longitude: longitude || null,
            status: "Beklemede", // Beklemede, Kabul Edildi, Reddedildi
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await newChallengeRef.set(challengeData);
        res.status(201).json({ message: "Meydan okuma gönderildi!", challenge: challengeData });
    } catch (error) {
        console.error("Meydan okuma hatası:", error);
        res.status(500).json({ error: "Meydan okuma gönderilemedi." });
    }
});

// 20. Meydan Okumayı Yanıtla
app.post('/api/teams/challenge/respond', async (req, res) => {
    try {
        const { challengeId, status } = req.body;
        if (!challengeId || !status) {
            return res.status(400).json({ error: "Challenge ID ve durum gerekli!" });
        }

        await db.collection('CHALLENGES').doc(challengeId).update({
            status: status, // "Kabul Edildi" veya "Reddedildi"
            respondedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).json({ message: `Meydan okuma ${status}!` });
    } catch (error) {
        console.error("Meydan okuma yanıt hatası:", error);
        res.status(500).json({ error: "Yanıt gönderilemedi." });
    }
});

// 21. Takımın Meydan Okumalarını Getir
app.get('/api/teams/challenges/:teamId', async (req, res) => {
    try {
        const { teamId } = req.params;
        
        // Hem gönderilen hem alınan meydan okumaları çek
        const sentSnapshot = await db.collection('CHALLENGES')
            .where('challengerTeamId', '==', teamId)
            .get();
        
        const receivedSnapshot = await db.collection('CHALLENGES')
            .where('targetTeamId', '==', teamId)
            .get();

        const challenges = [];
        sentSnapshot.forEach(doc => challenges.push({ ...doc.data(), direction: 'sent' }));
        receivedSnapshot.forEach(doc => challenges.push({ ...doc.data(), direction: 'received' }));

        res.status(200).json({ challenges: challenges });
    } catch (error) {
        console.error("Meydan okuma çekme hatası:", error);
        res.status(500).json({ error: "Meydan okumalar getirilemedi." });
    }
});

// ==========================================
// --- SUNUCU BAŞLATMA (HER ZAMAN EN ALTTA!) ---
// ==========================================
app.listen(PORT, () => {
    console.log(`HSS Backend Sunucusu http://localhost:${PORT} adresinde çalışıyor!`);
});