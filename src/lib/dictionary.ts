import type { Ending, Mark } from './types';

/** What earns each mark. The thresholds are points of winning chances, out of 100. */
export const MARK_MEANING: Record<Mark, string> = {
  brilliant: 'A sound sacrifice: the move offers a piece, is among the best available, and the game was not already won without it.',
  great: 'The only good move. It is the engine’s choice, and every other move gives up at least 12 points of winning chances.',
  best: 'The engine’s first choice.',
  excellent: 'Gives up 2 points of winning chances or fewer.',
  good: 'Gives up between 2 and 5 points.',
  book: 'A known opening move, while the game follows theory from the first move.',
  forced: 'The only legal move.',
  inaccuracy: 'Gives up between 5 and 10 points.',
  miss: 'Gives up 10 points or more, but only by failing to punish an error the opponent just made.',
  mistake: 'Gives up between 10 and 20 points.',
  blunder: 'Gives up more than 20 points.',
};

export interface Term {
  id: string;
  name: string;
  text: string;
}

/** The words the reviews use, in the order a newcomer meets them. */
export const TERMS: Term[] = [
  {
    id: 'notation',
    name: 'Move notation',
    text: 'Moves are written in algebraic notation. A capital letter names the piece: K king, Q queen, R rook, B bishop, N knight. Pawns have no letter. Then comes the square the piece moves to, so Nf3 is a knight going to f3 and e4 is a pawn going to e4. An x means a capture (Bxf7), + is check, # is checkmate, O-O is castling on the king’s side, O-O-O on the queen’s side, and e8=Q is a pawn becoming a queen.',
  },
  {
    id: 'move-number',
    name: 'Move numbers',
    text: '12. is White’s twelfth move and 12… is Black’s reply. One move is a turn for each side, so a 40-move game has about 80 positions to look at.',
  },
  {
    id: 'evaluation',
    name: 'Evaluation (+0.3, −1.5, M3)',
    text: 'The engine’s score for a position, in pawns, from White’s side. +1.0 means White is about a pawn better; a minus sign means Black is better. Anything within about half a pawn of 0.0 is roughly equal. M3 means White can force mate in three moves, −M3 that Black can, and # that the game has ended in checkmate.',
  },
  {
    id: 'winning-chances',
    name: 'Winning chances',
    text: 'The evaluation turned into a chance of winning from 0 to 100, using a curve fitted on real games. Moves are judged by how many of these points they give away, because being a pawn up matters far more in a level position than when you are already a rook ahead.',
  },
  {
    id: 'accuracy',
    name: 'Accuracy',
    text: 'How close a side’s moves came to the engine’s, from 0 to 100. Moves played while the position was swinging count for more, and a few very bad moves cost more than many small slips.',
  },
  {
    id: 'best-line',
    name: 'Best move and line',
    text: 'The move the engine would have played, and how it expects the game to go after it. Showing the best move draws it as an arrow on the position before your move.',
  },
  {
    id: 'phases',
    name: 'Opening, middlegame and endgame',
    text: 'The opening lasts while the game follows known theory and most pieces are still at home. It becomes a middlegame once pieces have left the back rank, trades begin or move 12 has passed. It becomes an endgame when each side has about three pieces left, not counting kings and pawns.',
  },
  {
    id: 'book',
    name: 'Book and opening theory',
    text: 'The well-known moves that strong players have tested for decades. A book move is one of them. The review stops calling moves book the first time the game leaves known theory.',
  },
  {
    id: 'eco',
    name: 'ECO code (B90, C42…)',
    text: 'The Encyclopaedia of Chess Openings, first published in Belgrade in 1974, gives every opening a code from A00 to E99. A covers flank openings such as 1.c4 and 1.Nf3. B covers replies to 1.e4 other than 1…e5, including the Sicilian. C covers 1.e4 e5 and the French Defence. D covers 1.d4 d5. E covers the Indian defences to 1.d4.',
  },
  {
    id: 'opening-names',
    name: 'How openings are named',
    text: 'An opening is usually named after a player who made it popular, a place where it was played, or what it looks like. A Defence is named from Black’s side and a Game, Opening, Attack or System from White’s. The part after the colon is the variation, and after a comma the sub-variation: in “Sicilian Defense: Najdorf Variation, English Attack”, Najdorf is the variation and English Attack the line within it.',
  },
  {
    id: 'gambit',
    name: 'Gambit',
    text: 'An opening that gives away material, usually a pawn, for quick development, the centre or an attack. It is Accepted when the other side takes it and Declined when they do not. A countergambit is a gambit played in reply to one.',
  },
  {
    id: 'fianchetto',
    name: 'Fianchetto',
    text: 'Developing a bishop to b2, g2, b7 or g7 after moving the pawn in front of it one square, so the bishop looks down the long diagonal. It is the mark of the Indian defences and of many modern openings.',
  },
  {
    id: 'fork',
    name: 'Fork',
    text: 'One piece attacking two or more of the opponent’s pieces at once, so that only one of them can be saved. Knight forks are the most common, because they are easy to overlook.',
  },
  {
    id: 'hanging',
    name: 'Hanging piece',
    text: 'A piece that can be taken without enough being won back. The review says a piece is left to be taken when the move ignored a threat, and can be taken when the piece itself walked into it.',
  },
  {
    id: 'sacrifice',
    name: 'Sacrifice',
    text: 'Giving up material on purpose for something worth more: an attack, a mate, or a much better position. A sound sacrifice that is also one of the best moves is marked Brilliant.',
  },
  {
    id: 'only-move',
    name: 'Only move',
    text: 'A position with exactly one good move, where every other choice gives up a lot. Finding it is marked Great.',
  },
  {
    id: 'time-pressure',
    name: 'Time pressure',
    text: 'A mistake made with a tenth of the starting time or less on the clock, or the last five seconds in very fast games. The review notes the clock so you can tell the errors you made thinking apart from the ones you made hurrying.',
  },
  {
    id: 'engine',
    name: 'Engine and depth',
    text: 'Stockfish, the chess program that does the review, looks a number of moves ahead from every position. Quick, Standard and Deep reviews let it look further each time, which finds more but takes longer.',
  },
];

/**
 * How a game can end, as the games list and each game say it. Listed in the order they are
 * most often met: most games end in a resignation or a checkmate.
 */
export const ENDINGS: { id: Ending; name: string; text: string }[] = [
  {
    id: 'resignation',
    name: 'Resignation',
    text: 'A player gives up, usually because the position is lost and playing on would only delay the end. Most games between experienced players end this way, long before checkmate. Resigning counts as a loss, exactly like being checkmated.',
  },
  {
    id: 'checkmate',
    name: 'Checkmate',
    text: 'The king is attacked and there is no way to get it out of danger, so the game ends at once. The mating move is written with a #, as in Qh4#.',
  },
  {
    id: 'time',
    name: 'On time',
    text: 'A player’s clock reached zero, so they lose, however good their position was. The one exception is when the opponent has too little left to ever give checkmate: then it is a draw, called timeout vs insufficient material.',
  },
  {
    id: 'abandoned',
    name: 'Abandoned (AFK)',
    text: 'A player left the game: they closed it, lost the connection or stopped moving, often called going AFK, away from keyboard. On chess.com they lose if they do not come back in time; on Lichess the opponent can claim the win once a countdown runs out. Either way it counts as a loss for the player who left.',
  },
  {
    id: 'time-insufficient',
    name: 'Timeout vs insufficient material',
    text: 'One player ran out of time, but the other could never have forced checkmate with what they had left, such as a bare king, or a king and a single knight or bishop. Since no sequence of moves would have let them win, the game is a draw instead of a loss on time.',
  },
  {
    id: 'agreement',
    name: 'Draw by agreement',
    text: 'One player offered a draw and the other accepted. It usually happens in level positions where neither side can make progress.',
  },
  {
    id: 'repetition',
    name: 'Draw by repetition',
    text: 'The same position, with the same player to move and the same castling and en passant rights, came up three times. The game is then a draw; online it ends on its own. Repeating moves on purpose is a common way to hold a worse position.',
  },
  {
    id: 'stalemate',
    name: 'Stalemate',
    text: 'The player to move has no legal move, but their king is not in check. It is a draw, not a win, which is why a side that is far ahead must be careful in the endgame, and a side that is far behind can sometimes save the game.',
  },
  {
    id: 'insufficient',
    name: 'Insufficient material',
    text: 'Neither side has enough left to give checkmate in any way: king against king, a king and one bishop or one knight against a king, or kings with bishops all on squares of the same colour. The game is drawn at once.',
  },
  {
    id: 'fifty',
    name: '50-move rule',
    text: 'Fifty moves by each side went by without a capture or a pawn move. The game is then a draw, so a side that cannot make progress does not have to play on forever.',
  },
];

/**
 * Where the name of an opening family comes from. Only families with a well-known
 * history are listed; the rest are named after what the moves look like.
 */
export const ORIGINS: Record<string, string> = {
  'Alekhine Defense':
    'Named after Alexander Alekhine, world champion from 1927 to 1935 and from 1937 to 1946, who brought it into master play in 1921. Black’s knight invites White’s pawns forward, planning to attack them once they are overextended.',
  "Anderssen's Opening": 'Adolf Anderssen, the leading player of the 1850s, played 1.a3 several times in his 1858 match against Paul Morphy.',
  'Benko Gambit':
    'Made popular around 1970 by Pal Benko, the Hungarian-American grandmaster; in Russia it is called the Volga Gambit. Black gives a pawn on the queenside for long-lasting pressure down the a- and b-files.',
  'Benoni Defense':
    'The name comes from a book by Aaron Reinganum, published in 1825, called Ben-Oni, Hebrew for “son of my sorrow”. Black lets White have more space in the centre in return for active piece play.',
  'Bird Opening': 'Named after Henry Bird, an English player who played 1.f4 for decades in the second half of the 1800s.',
  "Bishop's Opening": 'One of the oldest ways to play after 1.e4 e5, already analysed by Philidor in the 1700s. White aims the bishop at Black’s weak point on f7 before deciding where the knight goes.',
  'Blackmar-Diemer Gambit':
    'Named after Armand Blackmar, a music publisher from New Orleans who played the idea in the 1880s, and Emil Josef Diemer, a German player who spent decades refining it from the 1930s. White gives a pawn for fast development and an attack.',
  'Bogo-Indian Defense': 'Named after Efim Bogoljubov, who twice challenged Alekhine for the world title, in 1929 and 1934.',
  'Bongcloud Attack':
    'A joke opening named on an internet forum: 2.Ke2 moves the king for no reason at all. Top players have played it in online games for fun.',
  'Caro-Kann Defense':
    'Named after Horatio Caro, an English player in Berlin, and Marcus Kann, from Vienna, who analysed it in 1886. Solid and hard to break down, it has been a favourite of world champions from Capablanca to Karpov.',
  'Catalan Opening':
    'Introduced by Savielly Tartakower at Barcelona in 1929, when the organisers asked for an opening named after the region. White fianchettoes the king’s bishop and aims it at Black’s queenside.',
  'Colle System': 'Named after Edgard Colle, a Belgian master of the 1920s. White builds a quiet pawn triangle and prepares e4 later.',
  'Danish Gambit': 'Named after Danish players who analysed it in the 1800s. White can give two pawns to bring both bishops to bear on Black’s king.',
  'Dutch Defense':
    'Named after Elias Stein, a player living in the Netherlands, who recommended 1…f5 in his 1789 book. Black fights for e4 with a pawn from the side and often attacks on the king’s side.',
  'English Opening':
    'Named after Howard Staunton, the leading English player, who used 1.c4 in his 1843 match against Pierre Saint-Amant. It is a Sicilian Defence with the colours reversed and an extra move for White.',
  'English Defense': 'Developed by English grandmasters in the 1970s and 1980s, including Raymond Keene and Tony Miles. Black fianchettoes the queen’s bishop and challenges White’s centre from the side.',
  'Englund Gambit': 'Named after Fritz Englund, a Swedish player of the early 1900s. Black gives a pawn straight away against 1.d4. It is rarely seen at master level because White can keep the extra pawn safely.',
  'Four Knights Game': 'Named for its look: all four knights come out before anything else. It was the usual way to start a serious game in the late 1800s.',
  'French Defense':
    'Named after a correspondence match between London and Paris in 1834, in which the Paris team played 1…e6. Black builds a solid pawn chain and counterattacks White’s centre.',
  'Grob Opening': 'Named after Henri Grob, a Swiss master who played 1.g4 in thousands of games from the 1940s on. It weakens White’s king’s side for a quick attack on the long diagonal.',
  'Grünfeld Defense':
    'Introduced in 1922 by Ernst Grünfeld, an Austrian grandmaster. Black lets White build a big pawn centre, then attacks it with pieces. Garry Kasparov used it in his world championship matches.',
  'Hippopotamus Defense': 'Named for its look: Black sets up behind a low wall of pawns, with every piece tucked in, and waits for White to commit, like a hippopotamus lying low in the water.',
  'Indian Defense':
    'All the openings that start 1.d4 Nf6 are “Indian”. The name comes from games played in the 1800s by Moheschunder Bannerjee, a player in Bengal, who often developed his bishops on the long diagonals.',
  'Italian Game':
    'Named after the Italian masters of the 1500s and 1600s, such as Giulio Polerio and Gioachino Greco, who analysed it. The quiet main line is called the Giuoco Piano, Italian for “quiet game”. It is one of the oldest openings still played at the top.',
  "King's Gambit":
    'One of the oldest gambits, described by Ruy López in 1561. White gives the f-pawn to open the f-file and take the centre. It was the main attacking weapon of the 1800s, the Romantic era of chess.',
  "King's Indian Defense":
    'One of the Indian defences. Black lets White take the centre with pawns and then strikes back, usually with a pawn storm on the king’s side. It was a favourite of Bobby Fischer and Garry Kasparov.',
  "King's Indian Attack": 'The King’s Indian Defence played by White, with an extra move. Bobby Fischer used it against the French and Sicilian for years.',
  'Latvian Gambit': 'Named after players from Riga, Latvia, who analysed it in correspondence chess in the early 1900s, among them Kārlis Bētiņš. Black gives the f-pawn straight away. It is very risky.',
  'London System': 'Became popular after several players used it at the London tournament of 1922. White sets up the same way against nearly anything, with the bishop on f4.',
  'Modern Defense': 'A flexible way to meet 1.e4 that became popular in the 1960s. Black fianchettoes the king’s bishop and lets White take the centre, to attack it later.',
  'Nimzo-Indian Defense':
    'Named after Aron Nimzowitsch, one of the founders of the hypermodern school of the 1920s. Black pins the knight on c3 to stop White playing e4, and is willing to give up the bishop for it.',
  'Nimzowitsch Defense': 'Another opening of Aron Nimzowitsch. Black answers 1.e4 with 1…Nc6, attacking the centre with a piece instead of a pawn.',
  'Nimzo-Larsen Attack': 'Named after Aron Nimzowitsch and Bent Larsen, the Danish grandmaster who played 1.b3 at the top level in the 1960s and 1970s.',
  'Old Indian Defense': 'An older and quieter cousin of the King’s Indian, played by Mikhail Chigorin in the 1890s. Black’s bishop goes to e7 instead of g7.',
  'Owen Defense': 'Named after John Owen, an English vicar and strong player of the 1800s, who answered 1.e4 with 1…b6.',
  "Petrov's Defense":
    'Named after Alexander Petrov, the leading Russian player of the early 1800s, who analysed it in the 1840s; it is also called the Russian Game. Black counterattacks White’s e-pawn straight away. It is known as one of the most solid replies to 1.e4.',
  'Philidor Defense':
    'Named after François-André Danican Philidor, the French player and opera composer, who recommended it in his 1749 book. Philidor famously wrote that pawns are the soul of chess.',
  'Pirc Defense': 'Named after Vasja Pirc, a Slovenian grandmaster who developed it in the mid-1900s. Black fianchettoes the king’s bishop and invites White to overextend in the centre.',
  'Polish Opening':
    'Also called the Sokolsky Opening, after the Soviet player Alexei Sokolsky who wrote about it. Its nickname, the Orangutan, comes from Savielly Tartakower, who played 1.b4 in New York in 1924 after a visit to the zoo.',
  'English Orangutan': 'Savielly Tartakower played 1.b4 at New York in 1924 after a visit to the Bronx Zoo, and named it after an orangutan he had seen there.',
  'Ponziani Opening': 'Named after Domenico Ponziani, an Italian priest and chess writer of the 1700s. White prepares d4 with c3.',
  "Queen's Gambit":
    'One of the oldest openings, already written down around 1490. White offers the c-pawn to pull Black’s d-pawn away from the centre. It is not a true gambit, because White can usually win the pawn back.',
  "Queen's Indian Defense": 'One of the Indian defences, played often by Aron Nimzowitsch. Black fianchettoes the queen’s bishop to control e4.',
  'Réti Opening':
    'Named after Richard Réti, a leader of the hypermodern school, who beat world champion José Raúl Capablanca with it at New York in 1924, Capablanca’s first loss in eight years. White controls the centre from a distance instead of occupying it.',
  'Richter-Veresov Attack': 'Named after Kurt Richter, a German master, and Gavriil Veresov, from Belarus, who both played it in the mid-1900s.',
  'Rubinstein Opening': 'Named after Akiba Rubinstein, the Polish grandmaster who was one of the best players in the world in the 1910s.',
  'Ruy Lopez':
    'Named after Ruy López de Segura, a Spanish priest who analysed it in his book of 1561; it is also called the Spanish Game. White puts pressure on the knight that defends e5. It has been the main line of 1.e4 e5 at the top level for over a century.',
  'Scandinavian Defense':
    'Named after players from Scandinavia who analysed it in the 1800s; it is also called the Centre Counter. It is one of the oldest recorded openings, played in a game from Valencia in 1475. Black attacks White’s e-pawn at once.',
  'Scotch Game': 'Named after a correspondence match between Edinburgh and London in 1824, in which the Edinburgh team played it. White opens the centre with d4 at once.',
  'Sicilian Defense':
    'First written about by Italian authors around 1600, including Giulio Polerio. It is the most popular reply to 1.e4 among strong players: Black fights for the centre from the side and plays for a win, not just equality.',
  'Slav Defense': 'Named after the Slavic players who developed it around 1900, among them Semyon Alapin and Mikhail Chigorin. Black defends d5 with the c-pawn and keeps the light-squared bishop free.',
  'Semi-Slav Defense': 'A mix of the Slav and the Queen’s Gambit Declined: Black plays both c6 and e6. It leads to some of the sharpest lines in all of chess, such as the Botvinnik and the Meran.',
  'Tarrasch Defense':
    'Named after Siegbert Tarrasch, a German master and teacher of the late 1800s, who claimed it was the only correct answer to the Queen’s Gambit. Black accepts an isolated pawn in return for free piece play.',
  'Torre Attack': 'Named after Carlos Torre Repetto, a Mexican master who beat world champion Emanuel Lasker with it at Moscow in 1925.',
  'Trompowsky Attack': 'Named after Octávio Trompowsky, a Brazilian champion who played it in the 1930s and 1940s. White develops the bishop to g5 before the knight.',
  'Vienna Game': 'Named after the Viennese players who studied it in the mid-1800s. White develops the queen’s knight first, keeping f4 in reserve.',
  'Van Geet Opening': 'Named after Dirk Daniel van Geet, a Dutch master who played 1.Nc3 for many years.',
  'Zukertort Opening':
    'Named after Johannes Zukertort, who played 1.Nf3 and lost the first official world championship match to Wilhelm Steinitz in 1886. It keeps White’s plans flexible and can turn into many other openings.',
  'Center Game': 'Named for the idea: White opens the centre at once with 2.d4 and takes back with the queen.',
  'Three Knights Opening': 'Named for its look: three knights come out before anything else.',
  "King's Pawn Game": 'The family for 1.e4 lines that have no special name of their own.',
  "Queen's Pawn Game": 'The family for 1.d4 lines that have no special name of their own.',
};

/** The family an opening belongs to: "Sicilian Defense: Najdorf Variation" is in "Sicilian Defense". */
export function openingFamily(name: string): string {
  return name
    .split(':')[0]
    .replace(/,.*$/, '')
    .replace(/ (Accepted|Declined)$/, '');
}
