/** UI language. Strings are keyed by their English text; Portuguese (Brazil) is the translation table. */
export type Lang = "pt" | "en";

const PT: Record<string, string> = {
  // top bar and panels
  "Population": "População", "Jobs": "Empregos", "Date": "Data", "Balance": "Saldo",
  "Services": "Serviços", "Economy": "Economia", "Land value": "Valor do solo", "Traffic": "Tráfego", "Underground": "Subsolo",
  "Income (last month)": "Receita (mês passado)", "Expenses (last month)": "Despesas (mês passado)",
  "Tax rate": "Imposto", "cars": "carros", "none": "nenhum", "stops": "paradas", "tile": "trecho", "mo": "mês",
  "Popularity": "Popularidade", "Budget": "Orçamento", "Environment": "Meio ambiente",
  "Power": "Energia", "Water": "Água", "Sewage": "Esgoto", "Garbage": "Lixo",
  "Police": "Polícia", "Fire": "Bombeiros", "Health": "Saúde", "Education": "Educação", "Parks": "Parques", "Transit": "Transporte",
  // toolbar
  "Move": "Mover", "Roads": "Estradas", "Zones": "Zonas", "Bulldoze": "Demolir", "Infoview": "Mapas",
  "Residential": "Residencial", "Commercial": "Comercial", "Industrial": "Industrial",
  "Street": "Rua", "Avenue": "Avenida", "Highway": "Autoestrada", "Paint": "Pintar", "Line": "Linha", "Curve": "Curva",
  "Power plant": "Usina", "Water pump": "Bomba d'água", "Sewage outlet": "Saída de esgoto", "Landfill": "Aterro",
  "Police station": "Delegacia", "Fire station": "Bombeiros", "Clinic": "Clínica", "School": "Escola", "Park": "Parque",
  "Bus stop": "Ponto de ônibus", "Metro": "Metrô", "Metro station": "Estação de metrô", "Bus line": "Linha de ônibus", "Metro line": "Linha de metrô",
  "Off": "Desligado",
  // hints
  "Drag to move the camera": "Arraste para mover a câmera",
  "Paint roads": "Pinte estradas",
  "Zone residential": "Zona residencial", "Zone commercial": "Zona comercial", "Zone industrial": "Zona industrial",
  "Remove roads, zones and facilities": "Remove estradas, zonas e instalações",
  "Place a power plant (radius 14)": "Coloque uma usina (raio 14)",
  "Place a water pump near water (radius 10)": "Coloque uma bomba d'água perto da água (raio 10)",
  "Place a sewage outlet near water (radius 10)": "Coloque uma saída de esgoto perto da água (raio 10)",
  "Place a landfill (radius 12)": "Coloque um aterro (raio 12)",
  "Police station: crime cover (radius 12)": "Delegacia: cobertura contra crime (raio 12)",
  "Fire station: stops fires (radius 12)": "Bombeiros: evita incêndios (raio 12)",
  "Clinic: health cover (radius 12)": "Clínica: cobertura de saúde (raio 12)",
  "School: education, needed for level 3 (radius 14)": "Escola: educação, exigida no nível 3 (raio 14)",
  "Park: land value and happiness (radius 8)": "Parque: valor do solo e felicidade (raio 8)",
  "Place a bus stop on a street or avenue": "Coloque um ponto de ônibus em rua ou avenida",
  "Metro station: any free land tile (radius 9)": "Estação de metrô: qualquer terreno livre (raio 9)",
  "Tap bus stops in order, then Create line": "Toque nos pontos em ordem e depois em Criar linha",
  "Tap metro stations in order, then Create line": "Toque nas estações em ordem e depois em Criar linha",
  "Drag to paint road tiles": "Arraste para pintar trechos de estrada",
  "Tap a start, then an end": "Toque no início e depois no fim",
  "Tap start, a bend point, then the end": "Toque no início, na curva e no fim",
  "Roads: streets, avenues and highways": "Estradas: ruas, avenidas e autoestradas",
  "Menu: save, load, new city": "Menu: salvar, carregar, nova cidade",
  "{name}: tap a start point (or an existing road to connect)": "{name}: toque no ponto inicial (ou numa estrada para conectar)",
  "{name}: tap the bend point": "{name}: toque no ponto da curva",
  "{name}: tap the end point": "{name}: toque no ponto final",
  "{name}: {n} tiles, ${cost}": "{name}: {n} trechos, ${cost}",
  "Tap {what}s in the order the line should run ({n} picked)": "Toque nos {what} na ordem da linha ({n} escolhidos)",
  "{n} stops. Tap more, or Create line (the route loops)": "{n} paradas. Toque em mais, ou em Criar linha (a rota é circular)",
  "bus stop": "ponto de ônibus", "metro station": "estação de metrô",
  "Tap a {kind} {what}": "Toque em um {what}",
  // buttons
  "Finish road": "Terminar estrada", "Cancel": "Cancelar", "Create line": "Criar linha",
  // menu
  "Autosave": "Autosave", "Continue": "Continuar", "Slot {n}": "Slot {n}", "Empty": "Vazio",
  "Created at the start of each month": "Criado no início de cada mês",
  "Save": "Salvar", "Load": "Carregar", "New city": "Nova cidade", "Map seed": "Semente do mapa", "Generate": "Gerar",
  "Save file": "Arquivo de save", "Keep a copy or move it to another device": "Guarde uma cópia ou leve para outro aparelho",
  "Export": "Exportar", "Import": "Importar", "Back to the city": "Voltar à cidade",
  "Terrain": "Terreno", "Plains": "Planície", "Forest": "Floresta", "River": "Rio", "Coast": "Litoral", "Mountain": "Montanha", "Desert": "Deserto",
  "Could not load the map": "Não foi possível carregar o mapa",
  "Hospital": "Hospital", "High school": "Escola secundária", "Library": "Biblioteca", "Community centre": "Centro comunitário",
  "Museum": "Museu", "City hall": "Prefeitura", "Substation": "Subestação", "Culture": "Cultura",
  "General hospital: wide health cover (radius 18)": "Hospital geral: ampla cobertura de saúde (raio 18)",
  "Secondary school: wide education cover (radius 20)": "Escola secundária: ampla cobertura de educação (raio 20)",
  "Public library: culture and happiness (radius 12)": "Biblioteca: cultura e felicidade (raio 12)",
  "Community centre: culture and happiness (radius 10)": "Centro comunitário: cultura e felicidade (raio 10)",
  "City museum: culture and land value (radius 16)": "Museu: cultura e valor do solo (raio 16)",
  "City hall (one per city): happiness and tax income": "Prefeitura (uma por cidade): felicidade e arrecadação",
  "Substation: extends the power network (radius 14)": "Subestação: estende a rede de energia (raio 14)",
  "There is already a city hall": "Já existe uma prefeitura",
  "Pause": "Pausar", "Speed": "Velocidade", "Fewer vehicles": "Menos veículos", "More vehicles": "Mais veículos", "Remove line": "Remover linha",
  "Preferences": "Preferências", "Pop {n}": "Pop. {n}",
  // preferences
  "General": "Geral", "Graphics": "Gráficos", "Gameplay": "Jogabilidade", "Controls": "Controles",
  "Use tool": "Usar ferramenta", "Move camera": "Mover câmera", "Rotate": "Girar", "Zoom": "Zoom",
  "Left button / one finger": "Botão esquerdo / um dedo", "Right button, WASD / two fingers": "Botão direito, WASD / dois dedos",
  "Middle button, Q E / twist": "Botão do meio, Q E / torcer", "Wheel / pinch": "Roda / pinça", "Apply": "Aplicar", "Language": "Idioma", "Graphics quality": "Qualidade gráfica",
  "Low": "Baixa", "High": "Alta", "Low quality": "Baixa", "Medium quality": "Média", "High quality": "Alta", "Show tips": "Mostrar dicas",
  "Save automatically": "Salvar automaticamente", "Dynamic day/night": "Modo dia/noite dinâmico",
  "Restore defaults": "Restaurar padrões", "OK": "OK", "Resolution": "Resolução", "Auto": "Auto",
  // toasts
  "City loaded": "Cidade carregada", "Line created": "Linha criada", "City imported": "Cidade importada",
  "Save file downloaded": "Arquivo de save baixado", "Saved to slot {n}": "Salvo no slot {n}",
  "New city, seed {n}": "Nova cidade, semente {n}",
  "Autosave found: open the menu to continue": "Autosave encontrado: abra o menu para continuar",
  "Fire! A building burned down. Build a fire station.": "Incêndio! Um prédio queimou. Construa um posto de bombeiros.",
  // sim reasons
  "Not enough money": "Dinheiro insuficiente", "Cannot build on water": "Não é possível construir na água",
  "Tile is a road": "O terreno é uma estrada", "Zones must be within 4 tiles of a road": "A zona deve ficar a até 4 quadras de uma estrada", "Tile is zoned": "O terreno é uma zona", "Tile is occupied": "O terreno está ocupado",
  "Outside the map": "Fora do mapa", "Cannot remove the highway entry": "A entrada da autoestrada não pode ser removida",
  "Road would cross water": "A estrada cruzaria a água", "Road would cross a building": "A estrada cruzaria uma construção",
  "Road is too long": "Estrada longa demais", "A road needs a start and an end": "Uma estrada precisa de início e fim",
  "Bus stops go on a road": "Pontos de ônibus ficam em estradas", "Not on a highway": "Não em autoestradas",
  "There is already a stop here": "Já existe uma parada aqui",
  "A line needs at least two stops": "Uma linha precisa de ao menos duas paradas",
  "Unknown stop": "Parada desconhecida", "No road connects these stops": "Nenhuma estrada liga essas paradas",
  "Unknown line": "Linha desconhecida", "That slot is empty": "Esse slot está vazio",
  "Could not save: browser storage is full or blocked": "Não foi possível salvar: armazenamento cheio ou bloqueado",
  "The save file is damaged": "O arquivo de save está danificado",
  "This save is from a different version": "Este save é de outra versão",
  "That file is too large to be a Mayor save": "Arquivo grande demais para ser um save do Mayor",
  "Tap a bus stop": "Toque em um ponto de ônibus", "Tap a metro station": "Toque em uma estação de metrô",
  "Official maps": "Mapas oficiais", "Random terrain": "Terreno aleatório",
  "Beginner": "Iniciante", "Medium": "Médio", "Advanced": "Avançado",
  "Play": "Jogar", "Size": "Tamanho", "tiles": "trechos",
  // inspector card
  "Residents": "Moradores", "Level": "Nível", "Upkeep": "Manutenção", "Radius": "Raio", "Close": "Fechar",
};

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let lang: Lang = "pt";

export function detectLang(): Lang {
  try {
    return navigator.language.toLowerCase().startsWith("pt") ? "pt" : "en";
  } catch {
    return "pt";
  }
}

export function setLang(l: Lang): void { lang = l; }
export function getLang(): Lang { return lang; }

/** Translate `key`, filling `{name}` placeholders. Unknown keys pass through unchanged. */
export function tr(key: string, vars?: Record<string, string | number>): string {
  let s = lang === "pt" ? PT[key] ?? key : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translate a message coming from the simulation, including its few parametrised ones. */
export function trReason(reason: string): string {
  if (lang === "en") return reason;
  const m = /^(.+) must be within 3 tiles of water$/.exec(reason);
  if (m) return `${tr(m[1])} precisa estar a até 3 trechos da água`;
  const u = /^Use only (bus|metro) stops$/.exec(reason);
  if (u) return u[1] === "bus" ? "Use apenas pontos de ônibus" : "Use apenas estações de metrô";
  return tr(reason);
}

export function monthName(i: number): string {
  return (lang === "pt" ? MONTHS_PT : MONTHS_EN)[i];
}

/** Line names are stored as "Bus 1" / "Metro 2"; show them in the current language. */
export function lineName(stored: string): string {
  const m = /^(Bus|Metro) (\d+)$/.exec(stored);
  if (!m) return stored;
  return lang === "pt" ? `${m[1] === "Bus" ? "Ônibus" : "Metrô"} ${m[2]}` : stored;
}
