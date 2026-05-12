const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
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
// --- API UÇ NOKTALARI (ENDPOINTS) ---
// ==========================================

// 1. Kullanıcı Kayıt (Register)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { uid, username, position } = req.body;
        if (!uid || !username) return res.status(400).send({ error: "UID ve Username zorunludur!" });

        await db.collection('USERS').doc(uid).set({
            UserID: uid,
            Username: username,
            Skill_Rating: 0,
            Position: position || "Belirtilmedi"
        });
        res.status(201).send({ message: "Kullanıcı başarıyla oluşturuldu!", uid: uid });
    } catch (error) {
        res.status(500).send({ error: "Kayıt işlemi sırasında hata oluştu." });
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

// 7. VİDEO YÜKLEME UCU (Firestore Bağlantılı)
app.post('/api/media/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Video bulunamadı.' });
    }

    try {
        const username = req.body.username || '@oyuncu';
        const description = req.body.description || 'Sahalara dönüş! ⚽';
        
        // Yüklenen videonun tam URL'si
        const videoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

        const yeniVideoId = Date.now().toString();
        const yeniVideoVerisi = {
            id: yeniVideoId,
            username: username,
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

// 10. Yorum Yap (Comment)
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

// ==========================================
// --- SUNUCU BAŞLATMA (HER ZAMAN EN ALTTA!) ---
// ==========================================
app.listen(PORT, () => {
    console.log(`HSS Backend Sunucusu http://localhost:${PORT} adresinde çalışıyor!`);
});