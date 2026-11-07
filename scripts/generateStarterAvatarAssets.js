const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { ASSETS_AVATAR_ROOT, AVATAR_CANVAS_SIZE, CLOTHES } = require('../data/clothes');

const OUTLINE = '#2B2129';

function ensureDirs() {
    const subdirs = ['base', 'hair', 'hat', 'top', 'bottom', 'shoes', 'accessory'];
    for (const d of subdirs) {
        fs.mkdirSync(path.join(ASSETS_AVATAR_ROOT, d), { recursive: true });
    }
}

function makeCtx() {
    const canvas = createCanvas(AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    return { canvas, ctx };
}

function saveCanvas(canvas, relFile) {
    const outPath = path.join(ASSETS_AVATAR_ROOT, ...relFile.split('/'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

function roundRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

function drawCapsuleLimb(ctx, x1, y1, x2, y2, radius, fillStyle, strokeWidth = 3.5) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.arc(x1, y1, radius, angle + Math.PI / 2, angle - Math.PI / 2);
    ctx.arc(x2, y2, radius, angle - Math.PI / 2, angle + Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    }
}

// =========================================================
// 1. BASE CHIBI POLOS (3 Skin Tones)
// =========================================================
function generateBaseBody(relFile, skinMain, skinShadow, blushColor) {
    const { canvas, ctx } = makeCtx();

    // Soft ground shadow
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(128, 236, 46, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(25, 20, 35, 0.22)';
    ctx.fill();
    ctx.restore();

    // Arms (A-pose)
    drawCapsuleLimb(ctx, 97, 143, 75, 180, 8.5, skinMain, 3.5);
    drawCapsuleLimb(ctx, 159, 143, 181, 180, 8.5, skinMain, 3.5);

    // Chibi round hands
    for (const hx of [74, 182]) {
        ctx.beginPath();
        ctx.arc(hx, 182, 9, 0, Math.PI * 2);
        ctx.fillStyle = skinMain;
        ctx.fill();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    }

    // Legs
    drawCapsuleLimb(ctx, 113, 182, 113, 223, 9.5, skinMain, 3.5);
    drawCapsuleLimb(ctx, 143, 182, 143, 223, 9.5, skinMain, 3.5);

    // Bare chibi feet
    for (const fx of [111, 145]) {
        ctx.beginPath();
        ctx.ellipse(fx, 226, 12, 6.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = skinMain;
        ctx.fill();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    }

    // Torso
    ctx.beginPath();
    ctx.moveTo(99, 136);
    ctx.quadraticCurveTo(128, 132, 157, 136);
    ctx.lineTo(155, 184);
    ctx.quadraticCurveTo(128, 190, 101, 184);
    ctx.closePath();
    ctx.fillStyle = skinMain;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Modest plain mannequin innerwear ("chibi polos")
    // Base neutral singlet
    ctx.beginPath();
    ctx.moveTo(100, 142);
    ctx.quadraticCurveTo(128, 150, 156, 142);
    ctx.lineTo(155, 178);
    ctx.lineTo(101, 178);
    ctx.closePath();
    ctx.fillStyle = '#F2F4F7';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Base neutral shorts
    roundRectPath(ctx, 101, 176, 54, 15, 5);
    ctx.fillStyle = '#D0D5DD';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Neck
    roundRectPath(ctx, 119, 122, 18, 18, 6);
    ctx.fillStyle = skinShadow;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Ears
    for (const ex of [80, 176]) {
        ctx.beginPath();
        ctx.ellipse(ex, 89, 8, 10, 0, 0, Math.PI * 2);
        ctx.fillStyle = skinMain;
        ctx.fill();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ex, 89, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = skinShadow;
        ctx.fill();
    }

    // Chibi Head (rounded cute face)
    const traceHeadPath = () => {
        ctx.beginPath();
        ctx.moveTo(82, 82);
        ctx.bezierCurveTo(82, 42, 174, 42, 174, 82);
        ctx.bezierCurveTo(175, 114, 154, 129, 128, 129);
        ctx.bezierCurveTo(102, 129, 81, 114, 82, 82);
        ctx.closePath();
    };
    traceHeadPath();
    ctx.fillStyle = skinMain;
    ctx.fill();

    // Soft chin cel-shading clipped inside head
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(128, 129, 36, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = skinShadow;
    ctx.fill();
    ctx.restore();

    traceHeadPath();
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Rosy cheek blushes
    for (const bx of [96, 160]) {
        ctx.beginPath();
        ctx.ellipse(bx, 102, 8.5, 4.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = blushColor;
        ctx.fill();
    }

    // Expressive Anime Chibi Eyes
    for (const ex of [107, 149]) {
        // Sclera white
        ctx.beginPath();
        ctx.ellipse(ex, 89, 9.5, 11.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Iris
        ctx.beginPath();
        ctx.ellipse(ex, 90, 7.5, 9.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#3B2D4A';
        ctx.fill();

        // Lower lighter iris glow
        ctx.beginPath();
        ctx.ellipse(ex, 94, 5.5, 4.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#6E5687';
        ctx.fill();

        // Pupil
        ctx.beginPath();
        ctx.ellipse(ex, 90, 3.8, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#1D1526';
        ctx.fill();

        // Main sparkle catchlight
        ctx.beginPath();
        ctx.arc(ex - 2.8, 84.5, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Tiny secondary sparkle
        ctx.beginPath();
        ctx.arc(ex + 3, 94.5, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Upper eyelash arc
        ctx.beginPath();
        ctx.arc(ex, 88, 9.8, Math.PI * 1.08, Math.PI * 1.92);
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    }

    // Eyebrows
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.moveTo(99, 74);
    ctx.quadraticCurveTo(107, 70, 114, 73);
    ctx.moveTo(142, 73);
    ctx.quadraticCurveTo(149, 70, 157, 74);
    ctx.stroke();

    // Cute smile
    ctx.beginPath();
    ctx.moveTo(122, 107);
    ctx.quadraticCurveTo(128, 112.5, 134, 107);
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    saveCanvas(canvas, relFile);
}

// =========================================================
// 2. HAIR STYLES
// =========================================================
function generateHair(relFile, mainColor, highlightColor, styleType) {
    const { canvas, ctx } = makeCtx();

    if (styleType === 'ponytail') {
        // Side ponytail puff behind head-right
        ctx.beginPath();
        ctx.moveTo(166, 62);
        ctx.bezierCurveTo(198, 56, 206, 96, 188, 114);
        ctx.bezierCurveTo(178, 106, 174, 88, 166, 76);
        ctx.closePath();
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Hair tie ribbon
        ctx.beginPath();
        ctx.arc(170, 68, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#EB5757';
        ctx.fill();
        ctx.stroke();
    }

    if (styleType === 'wavy') {
        // Flowing wavy back locks on left & right shoulders
        ctx.beginPath();
        ctx.moveTo(82, 76);
        ctx.bezierCurveTo(66, 98, 68, 128, 82, 140);
        ctx.quadraticCurveTo(92, 132, 88, 108);
        ctx.closePath();
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(174, 76);
        ctx.bezierCurveTo(190, 98, 188, 128, 174, 140);
        ctx.quadraticCurveTo(164, 132, 168, 108);
        ctx.closePath();
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.stroke();
    }

    // Main hair dome + bangs + sideburns
    ctx.beginPath();
    if (styleType === 'spiky') {
        ctx.moveTo(78, 86);
        ctx.lineTo(72, 68);
        ctx.lineTo(82, 62);
        ctx.lineTo(78, 45);
        ctx.lineTo(98, 44);
        ctx.lineTo(108, 30);
        ctx.lineTo(126, 38);
        ctx.lineTo(144, 28);
        ctx.lineTo(156, 42);
        ctx.lineTo(178, 44);
        ctx.lineTo(173, 60);
        ctx.lineTo(184, 68);
        ctx.lineTo(178, 86);
    } else {
        ctx.moveTo(79, 88);
        ctx.bezierCurveTo(75, 34, 181, 34, 177, 88);
    }
    // Right sideburn
    ctx.lineTo(172, 98);
    ctx.lineTo(167, 74);
    // Bangs across forehead (above y=72 so eyes stay clear)
    ctx.lineTo(154, 66);
    ctx.lineTo(145, 73);
    ctx.lineTo(135, 63);
    ctx.lineTo(126, 74);
    ctx.lineTo(115, 63);
    ctx.lineTo(105, 73);
    ctx.lineTo(90, 66);
    // Left sideburn
    ctx.lineTo(84, 98);
    ctx.closePath();

    ctx.fillStyle = mainColor;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Glossy anime hair halo highlight (inside hair crown)
    ctx.beginPath();
    ctx.arc(128, 79, 23, Math.PI * 1.22, Math.PI * 1.78);
    ctx.lineWidth = 4;
    ctx.strokeStyle = highlightColor;
    ctx.stroke();

    saveCanvas(canvas, relFile);
}

// =========================================================
// 3. TOPS / SHIRTS / JACKETS / SUITS
// =========================================================
function generateTop(relFile, opts) {
    const { canvas, ctx } = makeCtx();
    const {
        mainColor,
        secondaryColor = null,
        longSleeve = false,
        style = 'tshirt'
    } = opts;

    // Sleeves
    if (longSleeve) {
        drawCapsuleLimb(ctx, 97, 143, 77, 175, 9.8, secondaryColor || mainColor, 3.5);
        drawCapsuleLimb(ctx, 159, 143, 179, 175, 9.8, secondaryColor || mainColor, 3.5);
    } else {
        drawCapsuleLimb(ctx, 97, 143, 85, 162, 10.2, secondaryColor || mainColor, 3.5);
        drawCapsuleLimb(ctx, 159, 143, 171, 162, 10.2, secondaryColor || mainColor, 3.5);
    }

    // Main Torso Garment
    ctx.beginPath();
    ctx.moveTo(96, 135);
    ctx.quadraticCurveTo(128, 142, 160, 135);
    ctx.lineTo(159, 183);
    ctx.quadraticCurveTo(128, 188, 97, 183);
    ctx.closePath();
    ctx.fillStyle = mainColor;
    ctx.fill();

    // Pattern / Style overlays inside clipped torso
    ctx.save();
    ctx.clip();

    if (style === 'flannel') {
        ctx.strokeStyle = 'rgba(20, 20, 25, 0.38)';
        ctx.lineWidth = 5;
        for (let y = 142; y <= 184; y += 12) {
            ctx.beginPath();
            ctx.moveTo(92, y);
            ctx.lineTo(164, y);
            ctx.stroke();
        }
        for (let x = 104; x <= 156; x += 14) {
            ctx.beginPath();
            ctx.moveTo(x, 132);
            ctx.lineTo(x, 188);
            ctx.stroke();
        }
    } else if (style === 'batik') {
        ctx.fillStyle = '#F2C94C';
        for (let y = 144; y <= 178; y += 12) {
            for (let x = 104; x <= 154; x += 12) {
                ctx.beginPath();
                ctx.arc(x + ((y % 24 === 0) ? 4 : 0), y, 2.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    } else if (style === 'hoodie') {
        // Front kangaroo pocket
        roundRectPath(ctx, 108, 163, 40, 16, 5);
        ctx.fillStyle = '#2B2F36';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    } else if (style === 'ojol') {
        // Black chest & bright reflective silver-white stripe + dark inner zip
        ctx.fillStyle = '#1E272E';
        ctx.fillRect(94, 134, 68, 16);
        ctx.fillStyle = '#F5F6FA';
        ctx.fillRect(94, 154, 68, 5);
        ctx.fillStyle = '#1E272E';
        ctx.fillRect(125, 135, 6, 52);
    } else if (style === 'raincoat') {
        // Reflective safety band + center placket
        ctx.fillStyle = '#FFF3B0';
        ctx.fillRect(94, 166, 68, 6);
        ctx.fillStyle = '#E09F3E';
        ctx.fillRect(125, 135, 6, 52);
    } else if (style === 'suit' || style === 'sultan_suit') {
        // crisp white dress shirt V-insert
        ctx.beginPath();
        ctx.moveTo(115, 135);
        ctx.lineTo(141, 135);
        ctx.lineTo(128, 168);
        ctx.closePath();
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Tie / Royal Sash
        ctx.beginPath();
        ctx.moveTo(125, 138);
        ctx.lineTo(131, 138);
        ctx.lineTo(132, 162);
        ctx.lineTo(128, 168);
        ctx.lineTo(124, 162);
        ctx.closePath();
        ctx.fillStyle = style === 'sultan_suit' ? '#EB5757' : '#C0392B';
        ctx.fill();

        if (style === 'sultan_suit') {
            // Gold trim & royal medal
            ctx.strokeStyle = '#F2C94C';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(114, 136);
            ctx.lineTo(128, 170);
            ctx.lineTo(142, 136);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(145, 154, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#F2C94C';
            ctx.fill();
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = OUTLINE;
            ctx.stroke();
        }
    }

    ctx.restore();

    // Torso Outline
    ctx.beginPath();
    ctx.moveTo(96, 135);
    ctx.quadraticCurveTo(128, 142, 160, 135);
    ctx.lineTo(159, 183);
    ctx.quadraticCurveTo(128, 188, 97, 183);
    ctx.closePath();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Hoodie drawstrings or collar
    if (style === 'hoodie') {
        ctx.strokeStyle = '#F2F4F7';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(121, 140);
        ctx.lineTo(121, 156);
        ctx.moveTo(135, 140);
        ctx.lineTo(135, 156);
        ctx.stroke();
    } else if (style === 'tshirt') {
        ctx.beginPath();
        ctx.arc(128, 136, 12, 0.1 * Math.PI, 0.9 * Math.PI);
        ctx.lineWidth = 3;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    }

    saveCanvas(canvas, relFile);
}

// =========================================================
// 4. BOTTOMS / PANTS / SHORTS
// =========================================================
function generateBottom(relFile, opts) {
    const { canvas, ctx } = makeCtx();
    const { mainColor, isShorts = false, beltColor = null, goldTrim = false, pockets = false } = opts;

    const legBottomY = isShorts ? 202 : 217;

    // Left & right pant legs
    roundRectPath(ctx, 102, 182, 22, legBottomY - 182, 6);
    ctx.fillStyle = mainColor;
    ctx.fill();
    ctx.lineWidth = 3.3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    roundRectPath(ctx, 132, 182, 22, legBottomY - 182, 6);
    ctx.fillStyle = mainColor;
    ctx.fill();
    ctx.stroke();

    // Waistband block
    roundRectPath(ctx, 99, 176, 58, 16, 5);
    ctx.fillStyle = mainColor;
    ctx.fill();
    ctx.stroke();

    if (pockets) {
        roundRectPath(ctx, 100, 193, 7, 12, 2);
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.lineWidth = 2.4;
        ctx.stroke();

        roundRectPath(ctx, 149, 193, 7, 12, 2);
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.stroke();
    }

    if (beltColor) {
        roundRectPath(ctx, 99, 176, 58, 6, 2);
        ctx.fillStyle = beltColor;
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Buckle
        roundRectPath(ctx, 124, 175, 8, 8, 2);
        ctx.fillStyle = '#F2C94C';
        ctx.fill();
        ctx.stroke();
    }

    if (goldTrim) {
        ctx.strokeStyle = '#F2C94C';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(104, 213);
        ctx.lineTo(122, 213);
        ctx.moveTo(134, 213);
        ctx.lineTo(152, 213);
        ctx.stroke();
    }

    saveCanvas(canvas, relFile);
}

// =========================================================
// 5. SHOES / FOOTWEAR
// =========================================================
function generateShoes(relFile, opts) {
    const { canvas, ctx } = makeCtx();
    const { mainColor, soleColor = '#FFFFFF', accentColor = null, style = 'sneakers' } = opts;

    for (const fx of [111, 145]) {
        if (style === 'sandal') {
            // White rubber sole
            ctx.beginPath();
            ctx.ellipse(fx, 228, 13, 6, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = OUTLINE;
            ctx.stroke();

            // Blue Y-strap
            ctx.beginPath();
            ctx.moveTo(fx - 9, 226);
            ctx.lineTo(fx, 221);
            ctx.lineTo(fx + 9, 226);
            ctx.moveTo(fx, 221);
            ctx.lineTo(fx, 227);
            ctx.lineWidth = 3;
            ctx.strokeStyle = mainColor;
            ctx.stroke();
            continue;
        }

        const topY = style === 'boots' || style === 'hype' ? 211 : 216;
        const h = 232 - topY;

        roundRectPath(ctx, fx - 13, topY, 26, h, 8);
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Sole
        roundRectPath(ctx, fx - 13.5, 227, 27, 6, 3);
        ctx.fillStyle = soleColor;
        ctx.fill();
        ctx.lineWidth = 2.6;
        ctx.stroke();

        if (accentColor) {
            ctx.beginPath();
            ctx.moveTo(fx - 7, 221);
            ctx.lineTo(fx + 7, 221);
            ctx.lineWidth = 3;
            ctx.strokeStyle = accentColor;
            ctx.stroke();
        }
    }

    saveCanvas(canvas, relFile);
}

// =========================================================
// 6. HATS & CROWNS
// =========================================================
function generateHat(relFile, style) {
    const { canvas, ctx } = makeCtx();

    if (style === 'cap') {
        // Baseball cap dome
        ctx.beginPath();
        ctx.arc(128, 52, 45, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#222831';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Front visor brim
        ctx.beginPath();
        ctx.moveTo(82, 52);
        ctx.quadraticCurveTo(132, 62, 186, 55);
        ctx.quadraticCurveTo(182, 47, 152, 48);
        ctx.lineTo(82, 52);
        ctx.closePath();
        ctx.fillStyle = '#393E46';
        ctx.fill();
        ctx.stroke();
    } else if (style === 'beanie') {
        ctx.beginPath();
        ctx.arc(128, 54, 46, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#C0392B';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Pom-pom on top
        ctx.beginPath();
        ctx.arc(128, 12, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#F2F4F7';
        ctx.fill();
        ctx.stroke();

        // Ribbed cuff
        roundRectPath(ctx, 80, 44, 96, 13, 6);
        ctx.fillStyle = '#E74C3C';
        ctx.fill();
        ctx.stroke();
    } else if (style === 'straw') {
        // Wide sun brim
        ctx.beginPath();
        ctx.ellipse(128, 50, 68, 12, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#F2C94C';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Straw dome
        ctx.beginPath();
        ctx.arc(128, 48, 40, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#F5D76E';
        ctx.fill();
        ctx.stroke();

        // Red ribbon band
        roundRectPath(ctx, 88, 42, 80, 7, 3);
        ctx.fillStyle = '#EB5757';
        ctx.fill();
        ctx.stroke();
    } else if (style === 'hardhat') {
        ctx.beginPath();
        ctx.arc(128, 52, 46, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#F2C94C';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Center ridge
        roundRectPath(ctx, 121, 8, 14, 42, 5);
        ctx.fillStyle = '#F9BF3B';
        ctx.fill();
        ctx.stroke();

        // Brim
        roundRectPath(ctx, 76, 48, 104, 8, 4);
        ctx.fillStyle = '#F39C12';
        ctx.fill();
        ctx.stroke();
    } else if (style === 'crown') {
        ctx.beginPath();
        ctx.moveTo(92, 50);
        ctx.lineTo(86, 20);
        ctx.lineTo(108, 34);
        ctx.lineTo(128, 12);
        ctx.lineTo(148, 34);
        ctx.lineTo(170, 20);
        ctx.lineTo(164, 50);
        ctx.closePath();
        ctx.fillStyle = '#F2C94C';
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();

        // Royal base band
        roundRectPath(ctx, 90, 44, 76, 9, 4);
        ctx.fillStyle = '#F39C12';
        ctx.fill();
        ctx.stroke();

        // Gems
        for (const [gx, col] of [[106, '#2F80ED'], [128, '#EB5757'], [150, '#27AE60']]) {
            ctx.beginPath();
            ctx.arc(gx, 39, 4.2, 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    saveCanvas(canvas, relFile);
}

// =========================================================
// 7. ACCESSORIES (Glasses, Mask, Headphones)
// =========================================================
function generateAccessory(relFile, style) {
    const { canvas, ctx } = makeCtx();

    if (style === 'glasses' || style === 'aviator') {
        const isDark = style === 'aviator';
        for (const gx of [107, 149]) {
            roundRectPath(ctx, gx - 14, 80, 28, 18, isDark ? 7 : 4);
            ctx.fillStyle = isDark ? 'rgba(20, 25, 35, 0.88)' : 'rgba(255, 255, 255, 0.28)';
            ctx.fill();
            ctx.lineWidth = 3.2;
            ctx.strokeStyle = isDark ? '#F2C94C' : '#1E272E';
            ctx.stroke();

            if (isDark) {
                // Cool lens reflection slash
                ctx.beginPath();
                ctx.moveTo(gx - 8, 94);
                ctx.lineTo(gx + 2, 83);
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = 'rgba(255,255,255,0.65)';
                ctx.stroke();
            }
        }
        // Bridge & temple arms
        ctx.beginPath();
        ctx.moveTo(82, 86);
        ctx.lineTo(93, 86);
        ctx.moveTo(121, 87);
        ctx.lineTo(135, 87);
        ctx.moveTo(163, 86);
        ctx.lineTo(174, 86);
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = isDark ? '#F2C94C' : '#1E272E';
        ctx.stroke();
    } else if (style === 'mask') {
        // Ear straps
        ctx.beginPath();
        ctx.moveTo(84, 92);
        ctx.lineTo(104, 102);
        ctx.moveTo(172, 92);
        ctx.lineTo(152, 102);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#222831';
        ctx.stroke();

        // Black streetwear face mask
        roundRectPath(ctx, 102, 98, 52, 22, 8);
        ctx.fillStyle = '#222831';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
    } else if (style === 'headphones') {
        // Neck band around collar
        ctx.beginPath();
        ctx.arc(128, 128, 22, 0.1 * Math.PI, 0.9 * Math.PI);
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#222831';
        ctx.stroke();

        // Left & right earcups resting on collarbone with glowing cyan LED ring
        for (const hx of [106, 150]) {
            ctx.beginPath();
            ctx.ellipse(hx, 138, 9, 11, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#2C3A47';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = OUTLINE;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(hx, 138, 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#00E5FF';
            ctx.lineWidth = 2.4;
            ctx.stroke();
        }
    }

    saveCanvas(canvas, relFile);
}

function generateAllStarterAssets() {
    ensureDirs();

    // 1. Base Bodies
    generateBaseBody('base/chibi_body_light.png', '#FFE4D0', '#F3C5A8', 'rgba(255, 120, 140, 0.42)');
    generateBaseBody('base/chibi_body_medium.png', '#E3AF84', '#C99065', 'rgba(235, 95, 115, 0.38)');
    generateBaseBody('base/chibi_body_dark.png', '#9E6B4B', '#7F5236', 'rgba(220, 80, 100, 0.35)');

    // 2. Hair
    generateHair('hair/hair_short_black.png', '#262833', '#52576E', 'short');
    generateHair('hair/hair_short_brown.png', '#6D4C3D', '#9E735E', 'short');
    generateHair('hair/hair_ponytail.png', '#3D2B3D', '#6E506E', 'ponytail');
    generateHair('hair/hair_messy_silver.png', '#DCE1E9', '#FFFFFF', 'spiky');
    generateHair('hair/hair_wavy_gold.png', '#F2C94C', '#FFF3B0', 'wavy');

    // 3. Tops
    generateTop('top/top_tshirt_white.png', { mainColor: '#FFFFFF', style: 'tshirt' });
    generateTop('top/top_flannel_red.png', { mainColor: '#D63031', longSleeve: true, style: 'flannel' });
    generateTop('top/top_batik_nusantara.png', { mainColor: '#6D4C3D', style: 'batik' });
    generateTop('top/top_hoodie_black.png', { mainColor: '#222831', longSleeve: true, style: 'hoodie' });
    generateTop('top/top_raincoat_yellow.png', { mainColor: '#F2C94C', longSleeve: true, style: 'raincoat' });
    generateTop('top/top_suit_executive.png', { mainColor: '#2C3E50', longSleeve: true, style: 'suit' });
    generateTop('top/top_ojol_jacket.png', { mainColor: '#27AE60', longSleeve: true, style: 'ojol' });
    generateTop('top/top_suit_sultan.png', { mainColor: '#F8F9FA', secondaryColor: '#F2C94C', longSleeve: true, style: 'sultan_suit' });

    // 4. Bottoms
    generateBottom('bottom/bottom_shorts_black.png', { mainColor: '#2D3436', isShorts: true });
    generateBottom('bottom/bottom_jeans_blue.png', { mainColor: '#2980B9', beltColor: '#5D4037' });
    generateBottom('bottom/bottom_cargo_olive.png', { mainColor: '#556B2F', pockets: true });
    generateBottom('bottom/bottom_pants_formal.png', { mainColor: '#222831', beltColor: '#111111' });
    generateBottom('bottom/bottom_sultan_gold.png', { mainColor: '#FFFFFF', beltColor: '#F2C94C', goldTrim: true });

    // 5. Shoes
    generateShoes('shoes/shoes_sandal_jepit.png', { mainColor: '#2F80ED', style: 'sandal' });
    generateShoes('shoes/shoes_sneakers_white.png', { mainColor: '#F5F6FA', soleColor: '#DFE4EA', accentColor: '#2F80ED', style: 'sneakers' });
    generateShoes('shoes/shoes_boots_brown.png', { mainColor: '#6D4C41', soleColor: '#3E2723', style: 'boots' });
    generateShoes('shoes/shoes_pantofel_black.png', { mainColor: '#1E272E', soleColor: '#111111', accentColor: '#576574', style: 'sneakers' });
    generateShoes('shoes/shoes_hype_neon.png', { mainColor: '#EB5757', soleColor: '#FFFFFF', accentColor: '#F2C94C', style: 'hype' });

    // 6. Hats
    generateHat('hat/hat_cap_black.png', 'cap');
    generateHat('hat/hat_beanie_red.png', 'beanie');
    generateHat('hat/hat_straw_farmer.png', 'straw');
    generateHat('hat/hat_helm_proyek.png', 'hardhat');
    generateHat('hat/hat_crown_sultan.png', 'crown');

    // 7. Accessories
    generateAccessory('accessory/acc_masker_medis.png', 'mask');
    generateAccessory('accessory/acc_glasses_black.png', 'glasses');
    generateAccessory('accessory/acc_sunglasses_aviator.png', 'aviator');
    generateAccessory('accessory/acc_headphones.png', 'headphones');

    // Verify all CLOTHES files exist
    for (const c of CLOTHES) {
        const p = path.join(ASSETS_AVATAR_ROOT, ...c.file.split('/'));
        if (!fs.existsSync(p)) {
            throw new Error(`Missing generated asset: ${p}`);
        }
    }
    console.log(`✅ Generated ${CLOTHES.length} chibi avatar PNG assets in ${ASSETS_AVATAR_ROOT}`);
}

if (require.main === module) {
    generateAllStarterAssets();
}

module.exports = { generateAllStarterAssets };
