from __future__ import annotations

import asyncio
import json
import math
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(r"D:\研二\LXDAO共学\有邻DAO")
CONTRACTS = ROOT / "黑客松" / "youlin-contracts"
ASSETS = ROOT / "youlin-interface" / "output" / "playwright" / "demo-video"
OUT = ROOT / "黑客松" / "Demo成片"
FONT = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")
W, H, FPS, TOTAL = 1920, 1080, 12, 190

CREAM = "#F5F4ED"
WHITE = "#FFFFFF"
INK = "#173D39"
MUTED = "#60716E"
GREEN = "#1F5A52"
MINT = "#DDEEE9"
PURPLE = "#6F5BD3"
PURPLE_LIGHT = "#ECE9FF"
GOLD = "#C9A227"
GOLD_LIGHT = "#FBF2CF"
LINE = "#D6DDD8"
RED = "#B5574E"


@dataclass(frozen=True)
class Scene:
    start: int
    end: int
    key: str
    kicker: str
    title: str
    narration: str
    captions: tuple[str, ...]


SCENES = (
    Scene(0, 10, "intro", "", "德不孤 必有邻", "有邻，取自“德不孤，必有邻”。公益不会孤立发生，它因善意而传播，也因共同参与而延续。", ("有邻，取自“德不孤，必有邻”。", "公益因善意而传播，也因共同参与而延续。")),
    Scene(10, 28, "problems", "WHY YOULIN", "公益协作，仍有四个难题", "公益项目常遇到四个问题：资金一次打完以后难以问责、无法有效追踪项目进度；规则由平台单方维护；个人参与留不下可信履历；发起和质疑又常常不需要承担责任成本。", ("资金一次打完以后，如何持续问责？", "平台维护的规则，谁能保证不被单方面修改？", "一次参与之后，个人留下什么可信履历？", "发起、质疑与公共决策，如何建立责任成本？")),
    Scene(28, 46, "pr", "ONCHAIN IDENTITY", "P 记录参与，R 沉淀声誉", "有邻 DAO 是一个以账户为中心的公益 DAO。P 是不可转让的项目参与凭证，记录账户真正参与过哪些项目并决定审核资格；R 是不可转让的统一声誉，汇总跨项目贡献，可以继续用于发起、质押和公共决策。三份合约分别记录参与、管理声誉，并执行资金、时间、评分和状态转换。", ("P 是项目参与凭证：记录参与关系，并决定审核资格。", "R 是统一声誉：汇总跨项目贡献，可用于发起与质押。", "三份智能合约共同执行资金、时间、评分与状态转换。")),
    Scene(46, 66, "initiate", "GATE 01 · JOINT INITIATION", "声誉持有者共同为项目 A 背书", "首先，项目方上传“乡村校园安全饮水计划”。项目不能由单个账户独自发起：它需要多位声誉持有者共同认可，并分别锁定自己的 R。只有共同发起人数和总质押都达到合约门槛，项目才进入第一轮募捐。", ("项目不能由单个账户独自发起。", "共同发起人分别确认，并锁定自己的 R。", "人数和总质押达到门槛后，合约才激活第一轮。")),
    Scene(66, 84, "round1", "GATE 02 · FIRST ROUND", "首轮达标，捐款者获得 P 与 R", "第一轮中，此前没有 R 的账户参与捐款。首次有效捐款会铸造项目 P；首轮达到合约设定的阶段目标后，捐款者还可以领取与首轮捐款等额的 R。项目方取得第一阶段资金，并在时限前提交中期材料。", ("首次有效捐款，合约铸造该项目的 P。", "首轮达到阶段目标后，捐款者可领取等额 R。", "项目方领取第一阶段资金，并提交中期材料。")),
    Scene(84, 105, "mid", "MID REVIEW · LOG WEIGHTED", "真正参与者，决定第二轮是否开放", "只有真正捐过款、持有项目 P 的账户才能进行中期评分。评分按捐款额对数加权，既承认投入差异，也避免大额账户完全垄断。只有中期评分通过合约门槛，第二轮募捐才会开放。", ("只有持有项目 P 的真实捐款者，才能进行中期评分。", "评分按捐款额对数加权，降低大额账户的垄断。", "中期评分通过合约门槛，第二轮才会开放。")),
    Scene(105, 122, "round2", "GATE 03 · SECOND ROUND", "中期结果公开后，公众再次表态", "第二轮筹集多少，项目就用多少继续推进。潜在捐款者可以参考中期结果，决定是否继续投入。本次真实测试网回放中，项目根据公开的中期评分继续获得支持，并达到筹款目标。", ("第二轮采用弹性筹款，不以募满作为结项条件。", "潜在捐款者参考中期结果，自主决定是否继续投入。", "本次回放中，公众再次支持，项目达到筹款目标。")),
    Scene(122, 143, "final", "FINAL REVIEW", "项目结果，再次交给捐款者评价", "项目完成后，项目方提交安装成果、水质检测和签收记录等演示材料。所有捐款者再根据最终履约情况完成结项评分，最终结果由合约根据累计捐款对数加权确定，而不是由平台后台填写。", ("项目方提交结项材料、证据 URI 与内容哈希。", "所有捐款者根据最终履约情况完成结项评分。", "合约按累计捐款对数加权，确定最终结果。")),
    Scene(143, 161, "settle", "GATE 04 · SETTLEMENT", "高分奖励，低分惩罚；挑战也有成本", "结算时，合约根据结项评分处理发起人的质押：执行不佳会损失 R，达到基准会返还质押，执行优秀还会获得额外声誉。结项后开放挑战窗口；挑战者和争议投票者同样必须质押声誉。发起、质疑与裁决都不是免费按钮。", ("合约根据结项评分，自动处理发起人的 R 质押。", "高分返还并奖励；低分会销毁部分或全部质押。", "挑战与争议投票同样要质押 R，承担责任成本。")),
    Scene(161, 177, "projectb", "A DONORS → B INITIATORS", "一次参与，成为下一次行动的起点", "最后，项目 A 的捐款者已经通过捐款和评价积累了 R。他们从参与者变成共同发起人，用新获得的声誉共同发起“偏远地区青少年编程启蒙工作”，项目 B 已由真实交易激活并进入第一轮募捐。", ("项目 A 的捐款者，通过参与和评价积累了 R。", "他们将新获得的声誉锁定，成为项目 B 的共同发起人。", "“偏远地区青少年编程启蒙工作”已进入第一轮募捐。")),
    Scene(177, 190, "answers", "FOUR QUESTIONS · FOUR ANSWERS", "让每一次公益参与，留下下一次行动的能力", "两轮募捐解决资金问责，合约状态机保证规则不可单方篡改，P 与 R 留下可信公益履历，双向质押建立责任成本。在有邻 DAO，一次公益参与，正是下一次公共行动的起点。", ("两轮募捐 · 合约状态机 · P + R · 双向质押", "在有邻 DAO，一次公益参与，正是下一次公共行动的起点。")),
)


def font(size: int, bold: bool = False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT), size)


def rounded(draw, box, radius=24, fill=WHITE, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, size, fill=INK, bold=False, anchor=None):
    draw.text(xy, value, font=font(size, bold), fill=fill, anchor=anchor)


def wrap(value: str, max_chars: int):
    lines, current = [], ""
    for ch in value:
        current += ch
        if len(current) >= max_chars and ch in "，。；：？！、 " or len(current) >= max_chars + 5:
            lines.append(current.strip())
            current = ""
    if current.strip():
        lines.append(current.strip())
    return lines


def paste_cover(canvas: Image.Image, source: Image.Image, box, dim=1.0, blur=0):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    ratio = max(bw / source.width, bh / source.height)
    resized = source.resize((math.ceil(source.width * ratio), math.ceil(source.height * ratio)), Image.Resampling.LANCZOS)
    left = (resized.width - bw) // 2
    top = (resized.height - bh) // 2
    crop = resized.crop((left, top, left + bw, top + bh))
    if blur:
        crop = crop.filter(ImageFilter.GaussianBlur(blur))
    if dim != 1.0:
        crop = ImageEnhance.Brightness(crop).enhance(dim)
    canvas.paste(crop, (x0, y0))


def short(addr: str):
    return f"{addr[:6]}…{addr[-4:]}"


def header(draw: ImageDraw.ImageDraw, scene: Scene, active: int | None = None):
    text(draw, (92, 48), "有邻 DAO", 34, INK, True)
    rounded(draw, (1550, 40, 1828, 94), 27, PURPLE_LIGHT, "#D7D0FF")
    text(draw, (1689, 67), "●  MONAD TESTNET", 22, PURPLE, True, "mm")
    if scene.kicker:
        text(draw, (92, 132), scene.kicker, 18, GREEN, True)
    text(draw, (92, 166), scene.title, 48, INK, True)
    stages = ("共同发起", "第一轮", "中期审核", "第二轮", "结项", "项目 B")
    x0, y = 94, 245
    for i, label in enumerate(stages):
        if i:
            draw.line((x0 - 34, y + 17, x0 - 8, y + 17), fill=LINE, width=3)
        fill = GREEN if active is not None and i <= active else WHITE
        outline = GREEN if active is not None and i <= active else LINE
        rounded(draw, (x0, y, x0 + 164, y + 36), 18, fill, outline)
        text(draw, (x0 + 82, y + 18), ("已 " if active is not None and i < active else "") + label, 17, WHITE if fill == GREEN else MUTED, True, "mm")
        x0 += 188
    if scene.key == "projectb":
        proof_label = "真实交易回放 · Project #6"
    elif active is not None:
        proof_label = "真实交易回放 · Project #5"
    else:
        proof_label = "A → B · 34 笔真实交易"
    text(draw, (1550, 248), proof_label, 18, MUTED)


def tx_strip(draw, txhash: str, block: str, contract="YoulinProtocol"):
    rounded(draw, (92, 862, 1828, 932), 18, "#102E2B")
    text(draw, (120, 887), "CONFIRMED", 17, "#8CE0C9", True)
    text(draw, (280, 887), contract, 18, WHITE, True)
    text(draw, (575, 887), f"tx  {txhash[:12]}…{txhash[-8:]}", 18, "#C8D7D3")
    text(draw, (1370, 887), f"block  {block}", 18, "#C8D7D3")


def metric(draw, box, label, value, tone=GREEN, note=""):
    rounded(draw, box, 22, WHITE, LINE)
    x0, y0, x1, y1 = box
    text(draw, (x0 + 24, y0 + 22), label, 18, MUTED)
    text(draw, (x0 + 24, y0 + 54), value, 35, tone, True)
    if note:
        text(draw, (x0 + 24, y1 - 26), note, 15, MUTED)


def screenshot_panel(img: Image.Image, screenshot: Image.Image, box, label: str):
    draw = ImageDraw.Draw(img)
    rounded(draw, box, 24, WHITE, LINE)
    x0, y0, x1, y1 = box
    inner = (x0 + 10, y0 + 46, x1 - 10, y1 - 10)
    paste_cover(img, screenshot, inner)
    text(draw, (x0 + 20, y0 + 24), label, 17, MUTED, True, "lm")


def render_base(scene: Scene, history: dict, life: dict, screens: dict[str, Image.Image]) -> Image.Image:
    img = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(img)
    snaps = {item["key"]: item for item in history["snapshots"]}

    if scene.key == "intro":
        return img

    active_map = {"initiate": 0, "round1": 1, "mid": 2, "round2": 3, "final": 4, "settle": 4, "projectb": 5}
    header(draw, scene, active_map.get(scene.key))

    if scene.key == "problems":
        cards = (
            ("01", "资金一次打完", "项目执行以后，如何继续问责？"),
            ("02", "规则由平台维护", "谁能保证不被单方面修改？"),
            ("03", "参与没有履历", "贡献如何留下可信记录？"),
            ("04", "决策没有成本", "发起、质疑怎样承担责任？"),
        )
        for i, (num, title, sub) in enumerate(cards):
            col, row = i % 2, i // 2
            x, y = 92 + col * 876, 328 + row * 244
            rounded(draw, (x, y, x + 836, y + 210), 28, WHITE, LINE)
            rounded(draw, (x + 26, y + 26, x + 88, y + 88), 20, GOLD_LIGHT)
            text(draw, (x + 57, y + 57), num, 20, GOLD, True, "mm")
            text(draw, (x + 118, y + 31), title, 31, INK, True)
            text(draw, (x + 118, y + 89), sub, 22, MUTED)
            text(draw, (x + 30, y + 163), "?", 38, RED, True)
        return img

    if scene.key == "pr":
        rounded(draw, (92, 322, 870, 736), 30, WHITE, LINE)
        rounded(draw, (118, 350, 350, 708), 28, PURPLE_LIGHT, "#D5CDFD")
        text(draw, (234, 448), "P", 104, PURPLE, True, "mm")
        text(draw, (234, 563), "PROJECT", 18, PURPLE, True, "mm")
        text(draw, (390, 367), "项目参与凭证", 34, INK, True)
        for i, line in enumerate(("不可转让", "记录参与关系", "决定项目审核资格")):
            text(draw, (390, 445 + i * 68), "—", 22, PURPLE, True)
            text(draw, (432, 445 + i * 68), line, 24, MUTED)
        rounded(draw, (910, 322, 1688, 736), 30, "#173D39")
        rounded(draw, (936, 350, 1168, 708), 28, "#28564F")
        text(draw, (1052, 448), "R", 104, WHITE, True, "mm")
        text(draw, (1052, 563), "REPUTATION", 18, "#B8D8D1", True, "mm")
        text(draw, (1208, 367), "统一声誉", 34, WHITE, True)
        for i, line in enumerate(("不可转让", "跨项目累积", "用于发起、质押与决策")):
            text(draw, (1208, 445 + i * 68), "—", 22, "#8CE0C9", True)
            text(draw, (1250, 445 + i * 68), line, 24, "#D8E7E3")
        contracts = (("YoulinParticipation", PURPLE_LIGHT, PURPLE), ("YoulinReputation", MINT, GREEN), ("YoulinProtocol", "#173D39", WHITE))
        for i, (name, bg, fg) in enumerate(contracts):
            x = 284 + i * 450
            rounded(draw, (x, 770, x + 398, 836), 20, bg, LINE)
            text(draw, (x + 199, 803), name, 19, fg, True, "mm")
        return img

    if scene.key == "initiate":
        s = snaps["activated"]
        rounded(draw, (92, 322, 1010, 816), 28, WHITE, LINE)
        text(draw, (124, 355), "项目 A · 乡村校园安全饮水计划", 30, INK, True)
        text(draw, (124, 402), "Monad Testnet 演示项目 · 真实链上状态", 18, MUTED)
        metric(draw, (124, 466, 394, 600), "筹款目标", "30 MON", GOLD)
        metric(draw, (412, 466, 682, 600), "共同发起", "3 / 3", GREEN)
        metric(draw, (700, 466, 970, 600), "已质押", "30 R", GREEN)
        for i, addr in enumerate(life["accounts"]["projectAInitiators"]):
            y = 638 + i * 52
            text(draw, (128, y), short(addr), 18, MUTED)
            text(draw, (702, y), "10 R  已锁定", 18, GREEN, True)
        rounded(draw, (1054, 322, 1828, 816), 28, "#173D39")
        text(draw, (1092, 358), "GATE 01 PASSED", 18, "#8CE0C9", True)
        text(draw, (1092, 412), "Draft", 30, "#A4B8B3")
        text(draw, (1370, 412), "→", 30, "#8CE0C9", True)
        text(draw, (1480, 412), "第一轮募捐", 30, WHITE, True)
        text(draw, (1092, 510), "YoulinReputation", 19, "#8CE0C9", True)
        text(draw, (1092, 547), "lockByProtocol · 锁定责任", 22, WHITE)
        text(draw, (1092, 620), "YoulinProtocol", 19, "#8CE0C9", True)
        text(draw, (1092, 657), "activateProject · 检查门槛并切换状态", 22, WHITE)
        tx_strip(draw, s["transactionHash"], s["blockNumber"])
        return img

    if scene.key in {"round1", "mid", "round2", "final"}:
        key = {"round1": "round1", "mid": "midFinalized", "round2": "round2", "final": "finalFinalized"}[scene.key]
        s = snaps[key]
        rounded(draw, (92, 322, 840, 816), 28, WHITE, LINE)
        text(draw, (124, 356), "Project #5 · 链上阶段快照", 24, INK, True)
        state_cn = {"MidSubmissionPending": "等待中期材料", "Round2Funding": "第二轮募捐", "FinalSubmissionPending": "等待结项材料", "ChallengeWindow": "挑战窗口"}[s["state"]]
        text(draw, (124, 404), state_cn, 38, GREEN, True)
        metric(draw, (124, 476, 446, 610), "第一轮", f"{s['round1MON']} / 15 MON", GOLD)
        metric(draw, (466, 476, 788, 610), "第二轮", f"{s['round2MON']} / 15 MON", GOLD)
        metric(draw, (124, 632, 446, 766), "中期评分", f"{s['midScore']} / 100", GREEN)
        metric(draw, (466, 632, 788, 766), "结项评分", f"{s['finalScore']} / 100", GREEN)
        rounded(draw, (884, 322, 1828, 816), 28, "#FAFAF7", LINE)
        text(draw, (916, 356), "捐款者账户 · 从链上恢复", 24, INK, True)
        for i, donor in enumerate(s["donors"]):
            y = 416 + i * 116
            rounded(draw, (916, y, 1796, y + 94), 20, WHITE, LINE)
            text(draw, (940, y + 23), short(donor["address"]), 19, INK, True)
            text(draw, (940, y + 58), f"首轮 {donor['round1MON']} · 二轮 {donor['round2MON']} MON", 17, MUTED)
            rounded(draw, (1400, y + 19, 1510, y + 72), 18, PURPLE_LIGHT)
            text(draw, (1455, y + 46), f"P × {donor['projectAP']}", 18, PURPLE, True, "mm")
            rounded(draw, (1530, y + 19, 1768, y + 72), 18, MINT)
            text(draw, (1649, y + 46), f"R {float(donor['r']):.2f}", 18, GREEN, True, "mm")
        contract = "YoulinParticipation + YoulinReputation" if scene.key == "round1" else "YoulinProtocol"
        tx_strip(draw, s["transactionHash"], s["blockNumber"], contract)
        return img

    if scene.key == "settle":
        screenshot_panel(img, screens["project-a-detail"], (92, 322, 1036, 816), "当前网站 · Project #5 已结算")
        rounded(draw, (1080, 322, 1828, 816), 28, WHITE, LINE)
        text(draw, (1112, 354), "发起人质押结算", 27, INK, True)
        for i in range(3):
            y = 410 + i * 106
            rounded(draw, (1112, y, 1796, y + 84), 18, "#F5FAF8", "#CDE2DC")
            text(draw, (1136, y + 24), f"发起人 {i+1}", 18, MUTED)
            text(draw, (1320, y + 24), "10.00 R 解锁", 20, INK, True)
            text(draw, (1562, y + 24), "+1.25 R", 21, GREEN, True)
        text(draw, (1112, 742), "低分：销毁质押   ·   挑战失败：挑战者损失 R", 18, RED, True)
        s = snaps["settled"]
        tx_strip(draw, s["transactionHash"], s["blockNumber"])
        return img

    if scene.key == "projectb":
        screenshot_panel(img, screens["project-b-detail"], (92, 322, 1040, 816), "当前网站 · Project #6 已激活")
        s = snaps["projectBActivated"]
        rounded(draw, (1084, 322, 1828, 816), 28, WHITE, LINE)
        text(draw, (1116, 352), "A 的捐款者 → B 的共同发起人", 27, INK, True)
        for i, donor in enumerate(s["donors"]):
            y = 412 + i * 112
            rounded(draw, (1116, y, 1796, y + 90), 20, "#F7F5FF", "#D8D1F7")
            text(draw, (1140, y + 21), short(donor["address"]), 18, INK, True)
            text(draw, (1140, y + 56), f"A: P × 1  ·  R {donor['r']}", 17, MUTED)
            text(draw, (1552, y + 35), "锁定 10 R", 20, PURPLE, True)
        rounded(draw, (1116, 746, 1796, 792), 18, MINT)
        text(draw, (1456, 769), "项目 B · 第一轮募捐已开放", 19, GREEN, True, "mm")
        tx_strip(draw, s["transactionHash"], s["blockNumber"])
        return img

    if scene.key == "answers":
        cards = (
            ("01", "两轮募捐 + 中期闸门", "先验证，再开放第二阶段资金"),
            ("02", "不可篡改的合约状态机", "资金、时间、资格、评分、结算均上链"),
            ("03", "P + R 双层公益履历", "参与关系与全局声誉持续积累"),
            ("04", "双向质押 + 挑战机制", "发起、质疑与裁决都要承担成本"),
        )
        for i, (num, title, sub) in enumerate(cards):
            col, row = i % 2, i // 2
            x, y = 92 + col * 876, 320 + row * 222
            rounded(draw, (x, y, x + 836, y + 190), 28, "#173D39")
            rounded(draw, (x + 25, y + 25, x + 87, y + 87), 20, "#28564F")
            text(draw, (x + 56, y + 56), num, 20, "#8CE0C9", True, "mm")
            text(draw, (x + 116, y + 29), title, 28, WHITE, True)
            text(draw, (x + 116, y + 84), sub, 20, "#C9DAD6")
            text(draw, (x + 30, y + 143), "已解决", 18, "#8CE0C9", True)
        text(draw, (960, 820), "youlin-dao-civic-profile-july24.mo-yang2023.chatgpt.site", 19, MUTED, anchor="mm")
        return img

    return img


def subtitle_variant(base: Image.Image, caption: str):
    img = base.copy()
    draw = ImageDraw.Draw(img, "RGBA")
    draw.rounded_rectangle((190, 958, 1730, 1042), radius=28, fill=(10, 35, 32, 230))
    lines = wrap(caption, 42)
    if len(lines) == 1:
        text(draw, (960, 1000), lines[0], 29, WHITE, True, "mm")
    else:
        text(draw, (960, 984), lines[0], 25, WHITE, True, "mm")
        text(draw, (960, 1018), "".join(lines[1:]), 25, WHITE, True, "mm")
    return np.asarray(img)[:, :, ::-1].copy()


def intro_frame(second: float, caption: str):
    img = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(img)
    text(draw, (92, 58), "YOULIN · MONAD TESTNET", 18, GREEN, True)
    if second < 5:
        alpha = min(1.0, second / 1.8)
        fill = tuple(int(x * alpha + 245 * (1 - alpha)) for x in (23, 61, 57))
        text(draw, (960, 480), "德不孤  必有邻", 104, fill, True, "mm")
        if second >= 3:
            text(draw, (960, 602), "Virtue is never solitary. It always has neighbors.", 24, MUTED, anchor="mm")
    else:
        p = min(1.0, (second - 5) / 2)
        ease = p * p * (3 - 2 * p)
        x = int(960 - 210 * ease)
        text(draw, (x, 480), "有邻", 116, INK, True, "mm")
        if second >= 7:
            q = min(1.0, second - 7)
            dao_fill = tuple(int(c * q + 245 * (1 - q)) for c in (111, 91, 211))
            text(draw, (x + 260, 480), "DAO", 88, dao_fill, True, "mm")
        if second >= 8:
            text(draw, (960, 610), "公益因善意而传播，也因共同参与而延续", 28, GREEN, anchor="mm")
    return subtitle_variant(img, caption)


def write_srt(path: Path):
    lines, index = [], 1
    for scene in SCENES:
        span = (scene.end - scene.start) / len(scene.captions)
        for i, cap in enumerate(scene.captions):
            start = scene.start + i * span
            end = scene.start + (i + 1) * span - 0.05
            def stamp(v):
                ms = round((v - int(v)) * 1000)
                return f"00:{int(v)//60:02d}:{int(v)%60:02d},{ms:03d}"
            lines += [str(index), f"{stamp(start)} --> {stamp(end)}", cap, ""]
            index += 1
    path.write_text("\n".join(lines), encoding="utf-8")


async def create_voice(text_value: str, output: Path):
    import edge_tts
    communicate = edge_tts.Communicate(text_value, "zh-CN-XiaoxiaoNeural", rate="-2%")
    await communicate.save(str(output))


def audio_duration(ffmpeg: str, path: Path):
    proc = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, text=True, encoding="utf-8", errors="ignore")
    match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", proc.stderr)
    if not match:
        raise RuntimeError("Cannot determine narration duration")
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    life = json.loads((CONTRACTS / "deployments" / "demo-video-lifecycle.json").read_text(encoding="utf-8"))
    history = json.loads((CONTRACTS / "deployments" / "demo-video-history.json").read_text(encoding="utf-8"))
    screens = {p.stem: Image.open(p).convert("RGB") for p in ASSETS.glob("*.png")}

    narration = "\n\n".join(scene.narration for scene in SCENES)
    narration_path = OUT / "有邻DAO_Demo_旁白全文.txt"
    narration_path.write_text(narration + "\n", encoding="utf-8")
    write_srt(OUT / "有邻DAO_Demo_中文字幕.srt")

    bases = {scene.key: render_base(scene, history, life, screens) for scene in SCENES if scene.key != "intro"}
    preview_dir = OUT / "关键帧"
    preview_dir.mkdir(exist_ok=True)
    for scene in SCENES:
        if scene.key != "intro":
            bases[scene.key].save(preview_dir / f"{scene.start:03d}_{scene.key}.png")

    silent = OUT / "有邻DAO_Demo_3分10秒_无声画面.mp4"
    writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    cache: dict[tuple[str, int], np.ndarray] = {}
    for frame_no in range(TOTAL * FPS):
        sec = frame_no / FPS
        scene = next(s for s in SCENES if s.start <= sec < s.end)
        scene_pos = sec - scene.start
        cap_index = min(len(scene.captions) - 1, int(scene_pos / (scene.end - scene.start) * len(scene.captions)))
        if scene.key == "intro":
            frame = intro_frame(scene_pos, scene.captions[cap_index])
        else:
            cache_key = (scene.key, cap_index)
            if cache_key not in cache:
                cache[cache_key] = subtitle_variant(bases[scene.key], scene.captions[cap_index])
            frame = cache[cache_key].copy()
        local = scene_pos
        if local < 0.6 and scene.start > 0:
            fade = max(0.05, local / 0.6)
            frame = (frame.astype(np.float32) * fade + np.full_like(frame, 245).astype(np.float32) * (1 - fade)).astype(np.uint8)
        cv2.rectangle(frame, (0, H - 7), (int(W * sec / TOTAL), H), (82, 90, 31), -1)
        writer.write(frame)
    writer.release()

    voice_raw = OUT / "有邻DAO_Demo_旁白_原始.mp3"
    asyncio.run(create_voice(narration, voice_raw))

    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    raw_duration = audio_duration(ffmpeg, voice_raw)
    target_audio = 188.7
    atempo = max(0.5, min(2.0, raw_duration / target_audio))
    final = OUT / "有邻DAO_Demo_3分10秒_中文字幕.mp4"
    cmd = [
        ffmpeg, "-y", "-i", str(silent), "-i", str(voice_raw),
        "-filter:a", f"atempo={atempo:.6f},apad=pad_dur=2",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-t", str(TOTAL), "-movflags", "+faststart", str(final),
    ]
    subprocess.run(cmd, check=True)
    proof = {
        "title": "有邻 DAO 黑客松 Demo 成片",
        "durationSeconds": TOTAL,
        "resolution": "1920x1080",
        "network": life["network"],
        "chainId": life["chainId"],
        "contracts": life["contracts"],
        "projectA": {**life["projectA"], **life["finalState"]["projectA"]},
        "projectB": {**life["projectB"], **life["finalState"]["projectB"]},
        "allTransactions": life["transactions"],
        "historicalSnapshotSource": str(CONTRACTS / "deployments" / "demo-video-history.json"),
        "voice": "Microsoft Edge zh-CN-XiaoxiaoNeural synthesized narration; no background music",
        "rawNarrationDurationSeconds": raw_duration,
        "audioTempoAdjustment": atempo,
    }
    (OUT / "有邻DAO_Demo_交易证明.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"video": str(final), "rawNarrationSeconds": raw_duration, "atempo": atempo}, ensure_ascii=False))


if __name__ == "__main__":
    main()
