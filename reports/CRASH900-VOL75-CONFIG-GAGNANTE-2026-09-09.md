# CRASH900 / Vol75 — « adopter la config des périodes gagnantes », 9 sept. 2026

Demande : retrouver quand CRASH900 et Vol75 ont gagné, et adopter cette configuration
en l'ajustant. Analyse trade par trade sur la base de prod (439 trades CRASH900 clôturés,
433 Vol75), découpée par tous les axes de config et de contexte.

## Réponse courte

**Il n'y a pas de config gagnante à adopter.** Dans les deux cas, tout le P&L positif vient
d'une poignée de trades qui correspondent à un *moment de marché*, pas à un réglage :

- CRASH900 : +146 $ au total, mais **+181 $ sur 40 trades à mise 100 $ / TP 10 % / SL 20 %,
  les 4–6 août**. Les 284 trades à mise 5 $ : **−5 $**. Les 14 autres jours : **−34 $**.
- Vol75 : +54 $ au total (PF 1,05 = pile ou face), mais **+119 $ sur la seule heure 08:00 UTC
  (25 trades)**. Sans cette heure, Vol75 est nettement négatif.

Ajuster la config pour coller à ces fenêtres = choisir les paramètres sur le résultat déjà
connu. C'est précisément ce qui a été fait les 6–7 août (entrées `best-day-strategy`,
`Bon Jour Crash 200$/jour` dans `config_changes`) et qui est reparti en perte en 3 jours.

## CRASH900 — détail

Total : 439 trades, WR 48,7 %, **PF 1,35**, +0,33 $/trade.

| Axe | Ce que montre la donnée |
|---|---|
| **Mise** | 100 $ → +181 $ (n=40, WR 65 %). **5 $ → −5,25 $** (n=284). 50 $ → −19 $. Tout le gain est le passage à 100 $. |
| **TP/SL** | `10/20` → +122 $ (n=28) · `10/10` → +59 $ (n=12). Toutes les autres combinaisons cumulées : **−35 $**. |
| **Jour** | 4 août +90,88 (WR **74 %**, 58 trades) · 5 août +69,67 · 6 août +19,65 = **+180**. Les 14 autres jours : **−34**. |
| **Après le 7 août** | Config figée ≈ 3 semaines : 8 août WR 26 %, 9 août 25 %, 16 août **0 %** (13 trades), 1 sept **0 %** (5). |
| **Confiance** | Bucket 70 : PF 2,78 · bucket 80 : PF 1,08 · bucket 90 : PF 1,45 mais WR 42 %. Non monotone — monter la confiance n'aide pas. |
| **Accord TF** | TF 3 → PF 1,46 (n=220) · **TF 4 → PF 1,27** (n=200). Le filtre plus strict fait *moins* bien. |
| **Heure** | Éparpillé (h13 +52, h18 +49, h14 −29, h12 −19). Aucun motif de session — juste où sont tombés les trades des 4–6 août. |

Le 4 août à 74 % de WR sur 58 trades est un jour à ~3 σ (grappe de spikes CRASH). Ne s'est
jamais reproduit. La « config gagnante » = mise ×20 posée pile sur ces 3 jours.

## Vol75 — détail

Total : 433 trades, WR 40,9 %, **PF 1,05**, +0,12 $/trade. **Une seule config sur toute la
période** (un seul `config_changes`, vide ; TF 4 sur 100 % des trades) — Vol75 *est déjà*
le test à config figée. Verdict : pile ou face.

| Axe | Ce que montre la donnée |
|---|---|
| **Stratégie** | `VOL75_1S_TREND_PULLBACK` (n=398) → **+14 $, PF 1,01**. `SCALPING_ENGINE` (n=35) → +40 $, PF 1,54. La stratégie nominale est nulle ; un petit échantillon scalping porte le total. |
| **Heure** | h08 **+119 $** (n=25) · h10 +62 · h06 +47 — contre h03 −67 · h14 −56 · h12 −41 · h22 −34. h08 seule = tout le P&L. |
| **Jour** | 28 août **−43,11** (WR 19 %, 31 trades) efface à lui seul 26+27 août (+40). |
| **Confiance** | Bucket 70 → −44 $ (PF 0,64). 80 → +76 $. 90 → +5,6 $. 100 → +17 $ (n=19). |

## Ce qu'on peut faire honnêtement

**Pas** remonter la mise à 100 $ : c'est ça qui a « fait » le chiffre CRASH900, c'est de
l'amplification de risque, pas un edge.

Le moins mauvais candidat, en **validation forward** (pas en rejouant le passé) :

- **CRASH900**, stratégie `crash`, **TF 3**, plancher confiance ~70, **mise fixe 5 $**,
  TP/SL modérés (ex. 10 / 10), une position à la fois, démo, **100+ trades** avec bilans
  20 / 50 / 100. Critère d'arrêt : PF < 1,0 sur 30 trades glissants → stop.
- Attente réaliste : proche de zéro. L'edge du backtest est très probablement l'anomalie
  des 4–6 août. Si les 100 trades forward sont positifs avec règles fixes, *là* c'est un
  signal. Sinon, c'est la réponse.

Vol75 : ne rien changer, le garder en observation. Restreindre à « heure 08:00 » serait un
ajustement sur 25 trades — le même piège.
