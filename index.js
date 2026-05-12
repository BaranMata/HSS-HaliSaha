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

// MVP İçin Geçici Video Veritabanı
let videoVeritabani = []; 

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

// 2. İlan Oluşturma (Create Match)
app.post('/api/matches/create', async (req, res) => {
    try {
        const { organizerId, latitude, longitude, requiredPosition } = req.body;
        if (!organizerId || !latitude || !longitude || !requiredPosition) return res.status(400).send({ error: "Eksik bilgi!" });

        const newMatchRef = db.collection('MATCH').doc();
        await newMatchRef.set({
            MatchID: newMatchRef.id,
            OrganizerID: organizerId,
            Latitude: latitude,
            Longitude: longitude,
            Required_Position: requiredPosition,
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

// 7. VİDEO YÜKLEME UCU (Buluta/Sunucuya Kayıt)
app.post('/api/media/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Video bulunamadı veya boyutu çok büyük.' });
    }

    const username = req.body.username || '@oyuncu';
    const description = req.body.description || 'Sahalara dönüş! ⚽';
    
    const videoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    const yeniVideo = {
        id: Date.now().toString(),
        username: username,
        description: description,
        videoUrl: videoUrl,
        likes: 0,
        comments: 0
    };

    videoVeritabani.unshift(yeniVideo); 
    console.log("Yeni video yüklendi:", videoUrl);
    res.status(200).json({ message: 'Efsane! Video başarıyla yüklendi.', video: yeniVideo });
});

// 8. REELS AKIŞI UCU (Mobil Uygulama Buradan Çekecek)
app.get('/api/media/feed', (req, res) => {
    // Sadece bu uç nokta çalışacak, çakışma bitti!
    res.status(200).json({ videos: videoVeritabani });
});


// ==========================================
// --- SUNUCU BAŞLATMA (HER ZAMAN EN ALTTA!) ---
// ==========================================
app.listen(PORT, () => {
    console.log(`HSS Backend Sunucusu http://localhost:${PORT} adresinde çalışıyor!`);
});