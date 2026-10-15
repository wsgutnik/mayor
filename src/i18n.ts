/** UI language. Strings are keyed by their English text; Portuguese (Brazil) is the translation table. */
export type Lang = "pt" | "en";

const PT: Record<string, string> = {
  // top bar and panels
  "Population": "População", "Jobs": "Empregos", "Date": "Data", "Balance": "Saldo",
  "City statistics": "Estatísticas da cidade", "Children": "Crianças", "Working age": "Idade ativa", "Seniors": "Idosos", "Employment rate": "Taxa de emprego", "Jobs filled": "Empregos ocupados", "Construction": "Construção",
  "planned": "planejado", "excavation": "escavação", "structure": "estrutura", "finishing": "acabamento", "complete": "concluído", "paused": "pausado", "upgrading": "em ampliação",
  "Services": "Serviços", "Economy": "Economia", "Land value": "Valor do solo", "Traffic": "Tráfego", "Underground": "Subterrâneo",
  "Income (last month)": "Receita (mês passado)", "Expenses (last month)": "Despesas (mês passado)",
  "Tax rate": "Imposto", "cars": "carros", "none": "nenhum", "stops": "paradas", "tile": "trecho", "mo": "mês",
  "Popularity": "Popularidade", "Budget": "Orçamento", "Environment": "Meio ambiente",
  "Demand": "Demanda", "Indicators": "Indicadores", "Transit lines": "Linhas de transporte",
  "Hide panels": "Ocultar painéis", "Show panels": "Mostrar painéis",
  "Power": "Energia", "Water": "Água", "Sewage": "Esgoto", "Garbage": "Lixo",
  "Police": "Polícia", "Fire": "Bombeiros", "Health": "Saúde", "Education": "Educação", "Parks": "Parques", "Transit": "Transporte",
  // toolbar
  "Move": "Mover", "Roads": "Estradas", "Zones": "Zonas", "Bulldoze": "Demolir", "Infoview": "Mapas",
  "Residential": "Residencial", "Commercial": "Comercial", "Industrial": "Industrial",
  "Street": "Rua", "Avenue": "Avenida", "Highway": "Autoestrada", "Paint": "Pintar", "Line": "Linha", "Curve": "Curva",
  "Marquee": "Retângulo", "Fill": "Preencher",
  "Snap": "Encaixe", "Angle": "Ângulo", "Road snap": "Encaixe nas estradas",
  "Guides": "Guias",
  "Touch offset": "Deslocamento do toque",
  "Parallel": "Paralela",
  "Upgrade road": "Melhorar via",
  // flyout sections and road facts (src/ui/hud.ts FLYOUT_I18N_KEYS, src/ui/road-facts.ts)
  "Type": "Tipo", "Draw": "Traçado", "Tools": "Ferramentas", "Zone": "Zona", "Shape": "Forma", "Stops": "Paradas",
  "Lanes": "Faixas", "Width": "Largura", "One-way": "Mão única", "per tile": "por trecho",
  "Press E to cycle": "Tecla E alterna", "Both legs are planned together and undo as one": "As duas vias são planejadas juntas e desfeitas de uma vez",
  "Tap a road to change its class": "Toque numa via para mudar a classe", "Gap": "Espaço", "Side": "Lado", "On": "Ligado", "Left": "Esquerda", "Right": "Direita",
  "Ground": "Solo", "Elevated": "Elevado",
  "One-way street": "Rua de mão única", "One-way avenue": "Avenida de mão única", "Roundabout": "Rotatória",
  "Stamp a roundabout on a junction": "Carimbe uma rotatória num cruzamento",
  "Tap a junction to stamp a roundabout": "Toque num cruzamento para criar a rotatória",
  "Roundabouts need a junction with at least 3 arms": "A rotatória precisa de um cruzamento com ao menos 3 braços",
  "No room for a roundabout here": "Não há espaço para uma rotatória aqui",
  "Power plant": "Usina", "Water pump": "Bomba d'água", "Sewage outlet": "Saída de esgoto", "Landfill": "Aterro",
  "Police station": "Delegacia", "Fire station": "Bombeiros", "Clinic": "Clínica", "School": "Escola", "Park": "Parque",
  "Bus stop": "Ponto de ônibus", "Metro": "Metrô", "Metro station": "Estação de metrô", "Bus line": "Linha de ônibus", "Metro line": "Linha de metrô", "Train": "Trem", "Train station": "Estação de trem", "Train line": "Linha de trem", "lines": "linhas", "vehicles": "veículos", "Solar plant": "Usina solar", "Large power plant": "Usina de grande porte", "Water tower": "Reservatório elevado", "Large water plant": "Estação de água grande", "Fire post": "Posto dos bombeiros", "Fire headquarters": "Quartel central", "Safety": "Segurança", "Health & schools": "Saúde e escolas", "City": "Cidade",
  "Off": "Desligado",
  // hints
  "Drag to move the camera": "Arraste para mover a câmera",
  "Draw roads": "Desenhe estradas: toque no início e depois no fim", "Paint roads": "Pinte estradas",
  "Zone residential": "Zona residencial", "Zone commercial": "Zona comercial", "Zone industrial": "Zona industrial",
  "Drag to zone a rectangle": "Arraste para zonear um retângulo", "Tap to fill the connected area": "Toque para preencher a área conectada",
  "Drag to clear a rectangle": "Arraste para limpar um retângulo", "Tap to clear the connected zones": "Toque para limpar as zonas conectadas",
  "Remove roads, zones and facilities": "Remove estradas, zonas e instalações",
  "Place a power plant (2x2, feeds the road grid)": "Coloque uma usina (2x2, alimenta a rede das estradas)",
  "Place a water pump near water (2x2, feeds the road grid)": "Coloque uma bomba d'água perto da água (2x2, alimenta a rede das estradas)",
  "Place a sewage outlet near water (feeds the road grid)": "Coloque uma saída de esgoto perto da água (alimenta a rede das estradas)",
  "Place a landfill (radius 12)": "Coloque um aterro (raio 12)",
  "Police station: crime cover (radius 12)": "Delegacia: cobertura contra crime (raio 12)",
  "Fire station: stops fires (radius 12)": "Bombeiros: evita incêndios (raio 12)",
  "Clinic: health cover (radius 12)": "Clínica: cobertura de saúde (raio 12)",
  "School: education, needed for level 3 (radius 14)": "Escola: educação, exigida no nível 3 (raio 14)",
  "Park: land value and happiness (radius 8)": "Parque: valor do solo e felicidade (raio 8)",
  "Place a bus stop on a street or avenue": "Coloque um ponto de ônibus em rua ou avenida",
  "Metro station: 2x2 footprint (radius 9)": "Estação de metrô: área 2x2 (raio 9)",
  "Tap bus stops in order, then Create line": "Toque nos pontos em ordem e depois em Criar linha",
  "Tap metro stations in order, then Create line": "Toque nas estações em ordem e depois em Criar linha",
  "Train station: 2x2 footprint (radius 12)": "Estação de trem: área 2x2 (raio 12)",
  "Tap train stations in order, then Create line": "Toque nas estações de trem em ordem e depois em Criar linha",
  "Tap a train station": "Toque em uma estação de trem",
  "Drag to paint road tiles": "Arraste para pintar trechos de estrada",
  "Tap a start, then an end": "Toque no início e depois no fim",
  "Tap start, a bend point, then the end": "Toque no início, na curva e no fim",
  "Roads: streets, avenues and highways": "Estradas: ruas, avenidas e autoestradas",
  "Menu: save, load, new city": "Menu: salvar, carregar, nova cidade",
  "{name}: tap a start point (or an existing road to connect)": "{name}: toque no ponto inicial (ou numa estrada para conectar)",
  "{name}: tap the bend point": "{name}: toque no ponto da curva",
  "{name}: tap the end point": "{name}: toque no ponto final",
  "Tap again to start": "Toque novamente para iniciar",
  "{name}: {n} tiles, ${cost}": "{name}: {n} trechos, ${cost}",
  "Tap to upgrade to {name} (${cost})": "Toque para converter em {name} (${cost})",
  "Tap {what}s in the order the line should run ({n} picked)": "Toque nos {what} na ordem da linha ({n} escolhidos)",
  "{n} stops. Tap more, or Create line (the route loops)": "{n} paradas. Toque em mais, ou em Criar linha (a rota é circular)",
  "bus stop": "ponto de ônibus", "metro station": "estação de metrô", "train station": "estação de trem",
  "Tap a {kind} {what}": "Toque em um {what}",
  // buttons
  "Finish road": "Terminar estrada", "Cancel": "Cancelar", "Create line": "Criar linha",
  "Undo": "Desfazer", "Redo": "Refazer", "Reset view": "Voltar à visão inicial",
  "{name}: tap a road to upgrade it": "{name}: toque numa via para melhorá-la",
  // menu
  "Autosave": "Autosave", "Continue": "Continuar", "Slot {n}": "Slot {n}", "Empty": "Vazio",
  "Created at the start of each month": "Criado no início de cada mês",
  "Save": "Salvar", "Load": "Carregar", "New city": "Nova cidade", "Map seed": "Semente do mapa", "Generate": "Gerar",
  "Save file": "Arquivo de save", "Keep a copy or move it to another device": "Guarde uma cópia ou leve para outro aparelho",
  "Export": "Exportar", "Import": "Importar", "Back to the city": "Voltar à cidade", "Back": "Voltar", "Buildings": "Prédios", "Build": "Construir",
  "Terrain": "Terreno", "Plains": "Planície", "Forest": "Floresta", "River": "Rio", "Coast": "Litoral", "Mountain": "Montanha", "Desert": "Deserto",
  "Could not load the map": "Não foi possível carregar o mapa",
  "Hospital": "Hospital", "High school": "Escola secundária", "Library": "Biblioteca", "Community centre": "Centro comunitário",
  "Museum": "Museu", "City hall": "Prefeitura", "Substation": "Subestação", "Culture": "Cultura",
  "General hospital: 2x2 footprint (radius 18)": "Hospital geral: área 2x2 (raio 18)",
  "Secondary school: 2x2 footprint (radius 20)": "Escola secundária: área 2x2 (raio 20)",
  "Public library: culture and happiness (radius 12)": "Biblioteca: cultura e felicidade (raio 12)",
  "Community centre: culture and happiness (radius 10)": "Centro comunitário: cultura e felicidade (raio 10)",
  "City museum: culture and land value (radius 16)": "Museu: cultura e valor do solo (raio 16)",
  "City hall (2x2, one per city): happiness and tax income": "Prefeitura (2x2, uma por cidade): felicidade e arrecadação",
  "Substation: relays power to nearby roads": "Subestação: retransmite energia para as estradas próximas",
  "There is already a city hall": "Já existe uma prefeitura",
  "Pause": "Pausar", "Speed": "Velocidade", "Fewer vehicles": "Menos veículos", "More vehicles": "Mais veículos", "Remove line": "Remover linha",
  "Preferences": "Preferências", "Pop {n}": "Pop. {n}",
  // preferences
  "General": "Geral", "Graphics": "Gráficos", "Gameplay": "Jogabilidade", "Controls": "Controles",
  "Use tool": "Usar ferramenta", "Move camera": "Mover câmera", "Rotate": "Girar", "Zoom": "Zoom",
  "Left button / one finger": "Botão esquerdo / um dedo", "Right button, WASD / two fingers": "Botão direito, WASD / dois dedos",
  "Middle button, Q E / twist": "Botão do meio, Q E / torcer", "Wheel / pinch": "Roda / pinça", "Apply": "Aplicar", "Language": "Idioma", "Graphics quality": "Qualidade gráfica",
  "Low": "Baixa", "High": "Alta", "Low quality": "Baixa", "Medium quality": "Média", "High quality": "Alta", "Show tips": "Mostrar dicas", "Street-aligned lots": "Lotes alinhados à rua",
  "No shadows · flat ground · fewer trees": "Sem sombras · solo chapado · menos árvores",
  "Soft shadows · textured ground": "Sombras suaves · solo texturizado",
  "Sharp shadows · detailed ground · dense trees": "Sombras nítidas · solo detalhado · árvores densas",
  "Save automatically": "Salvar automaticamente", "Dynamic day/night": "Modo dia/noite dinâmico",
  "Interface scale": "Escala da interface", "Panel opacity": "Opacidade dos painéis",
  "Restore defaults": "Restaurar padrões", "OK": "OK", "Resolution": "Resolução", "Auto": "Auto",
  // toasts
  "City loaded": "Cidade carregada", "Line created": "Linha criada", "City imported": "Cidade importada",
  "Save file downloaded": "Arquivo de save baixado", "Saved to slot {n}": "Salvo no slot {n}",
  "New city, seed {n}": "Nova cidade, semente {n}",
  "Autosave found: open the menu to continue": "Autosave encontrado: abra o menu para continuar",
  "Undone": "Desfeito", "Redone": "Refeito",
  "Fire! A building burned down. Build a fire station.": "Incêndio! Um prédio queimou. Construa um posto de bombeiros.",
  "Landmark appeared": "Marco apareceu",
  "A new landmark rises at {name}.": "Um novo marco surge: {name}.",
  // sim reasons
  "Not enough money": "Dinheiro insuficiente", "Cannot build on water": "Não é possível construir na água",
  "Facility footprint is outside the map": "A instalação não cabe no mapa", "Facility must be within 5 tiles of a connected road": "A instalação deve ficar a até 5 trechos de uma estrada conectada",
  "No room beside the street here": "Não há espaço ao lado da rua aqui",
  "Tile is a road": "O terreno é uma estrada", "Zones must be within 4 tiles of a road": "A zona deve ficar a até 4 lotes de uma estrada", "Tile is zoned": "O terreno é uma zona", "Tile is occupied": "O terreno está ocupado",
  "Outside the map": "Fora do mapa", "Cannot remove the highway entry": "A entrada da autoestrada não pode ser removida",
  "Road would cross water": "A estrada cruzaria a água", "Road would cross a building": "A estrada cruzaria uma construção",
  "Bridge": "Ponte", "Tunnel": "Túnel",
  "Bridge span too long": "Vão longo demais para uma ponte", "Tunnel span too long": "Trecho longo demais para um túnel",
  "Nothing to cross": "Nada para cruzar", "Tunnel too short": "Túnel curto demais",
  "Highways need an interchange": "Rodovias precisam de um trevo",
  "Cannot connect to a bridge or tunnel": "Não é possível ligar em ponte ou túnel",
  "Crossing at grade": "Cruzamento no nível", "Overpass": "Viaduto", "Underpass": "Passagem inferior",
  "Interchange": "Trevo", "Tap a bridge crossing to stamp an interchange": "Toque num cruzamento elevado para carimbar o trevo",
  "{n} viaduct": "{n} viaduto", "{n} viaducts": "{n} viadutos",
  "{n} underpass": "{n} passagem inferior", "{n} underpasses": "{n} passagens inferiores",
  "{n} crossing": "{n} cruzamento", "{n} crossings": "{n} cruzamentos",
  "Road is too long": "Estrada longa demais", "A road needs a start and an end": "Uma estrada precisa de início e fim",
  "Road leaves this junction too close to another road": "A estrada sai deste cruzamento perto demais de outra estrada",
  "Too close to a junction": "Perto demais de um cruzamento",
  "Overlaps another road": "Sobrepõe outra via",
  "Crossing angle too sharp": "Ângulo de cruzamento fechado demais",
  "Road already exists here": "Já existe uma via aqui",
  "use Upgrade road to change its class, or draw it parallel, clear of the sidewalk": "use Melhorar via para mudar a classe, ou desenhe em paralelo, fora da calçada",
  "cross at 20° or more, or end on the road to make a junction": "cruze a 20° ou mais, ou termine sobre a via para fazer um cruzamento",
  "use Upgrade road to change its class": "use Melhorar via para mudar a classe",
  "Joins junction": "Liga ao cruzamento",
  "Joins road": "Liga à via",
  "{n} lots per side": "{n} lotes por lado",
  "Road would crush lots": "A estrada destruiria lotes", "Highway would strand lots": "A autoestrada deixaria lotes sem acesso",
  "Cannot upgrade a roundabout": "Não é possível converter uma rotatória", "Unknown road": "Estrada desconhecida",
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
  "Residents": "Moradores", "Level": "Nível", "Upkeep": "Manutenção", "Footprint": "Área", "Radius": "Raio", "Close": "Fechar",
  // road-build readout
  "Cost": "Custo", "Length": "Comprimento", "Slope": "Inclinação",
  // toasts and bell
  "Notifications": "Notificações", "Clear all": "Limpar tudo", "Dismiss": "Dispensar",
  "Close notifications": "Fechar notificações", "All quiet — no notifications yet.": "Tudo quieto — sem notificações.",
  "Free": "Grátis",
  // onboarding guide
  "Getting started": "Primeiros passos", "Dismiss the guide": "Dispensar o guia",
  "Draw your first road": "Desenhe sua primeira estrada", "Zone homes beside it": "Zoneie casas ao lado",
  "Let the clock run": "Deixe o relógio correr", "Watch them move in": "Veja os moradores chegarem",
  "Roads is the first button below. Open it, tap a start point on the ground, then tap the end point — everything in a city grows along a street.": "Estradas é o primeiro botão abaixo. Abra, toque num ponto inicial no chão e depois no ponto final — tudo na cidade cresce ao longo de uma rua.",
  "Open Zones, take Residential, and drag over the ground next to your road.": "Abra Zonas, escolha Residencial e arraste pelo chão ao lado da estrada.",
  "Nothing is built while time crawls. Push the speed to 2× up in the clock — the plots start building straight away.": "Nada é construído com o tempo parado. Aumente a velocidade para 2× no relógio — os lotes começam a construir na hora.",
  "Buildings rise on each plot, then residents arrive. The RCI bars top-left tell you what to zone next.": "Prédios sobem em cada lote e os moradores chegam. As barras RCI no canto mostram o que zonear em seguida.",
  "Road tool ready. Tap a start point, then tap the end point to build.": "Ferramenta de estrada pronta. Toque num ponto inicial e depois no ponto final para construir.",
  "That is the whole loop": "Esse é o ciclo todo",
  "Road, zone, let time run. Watch the RCI bars and add services as people arrive.": "Estrada, zona, deixe o tempo correr. Acompanhe as barras RCI e adicione serviços com a chegada do povo.",
  // infoview legend
  "Power coverage": "Cobertura de energia", "Water coverage": "Cobertura de água", "Sewage coverage": "Cobertura de esgoto",
  "Garbage coverage": "Cobertura de lixo", "Police coverage": "Cobertura policial", "Fire coverage": "Cobertura de bombeiros",
  "Health coverage": "Cobertura de saúde", "Education coverage": "Cobertura de educação", "Park coverage": "Cobertura de parques",
  "Transit coverage": "Cobertura de transporte", "Culture coverage": "Cobertura de cultura",
  "Buildings the power grid reaches. Hatched blocks need supply.": "Prédios alcançados pela rede elétrica. Quarteirões hachurados precisam de fornecimento.",
  "Buildings the water network reaches. Hatched blocks need supply.": "Prédios alcançados pela rede de água. Quarteirões hachurados precisam de fornecimento.",
  "Buildings the sewage network drains. Hatched blocks need supply.": "Prédios drenados pela rede de esgoto. Quarteirões hachurados precisam de atendimento.",
  "Buildings the garbage service collects. Hatched blocks need a landfill.": "Prédios atendidos pela coleta. Quarteirões hachurados precisam de um aterro.",
  "Share of buildings the police reach. Hatched blocks need a station.": "Parcela dos prédios alcançada pela polícia. Quarteirões hachurados precisam de uma delegacia.",
  "Share of buildings the fire service reaches. Hatched blocks need a station.": "Parcela dos prédios alcançada pelos bombeiros. Quarteirões hachurados precisam de um posto.",
  "Share of buildings with health cover. Hatched blocks need a clinic.": "Parcela dos prédios com saúde. Quarteirões hachurados precisam de uma clínica.",
  "Share of buildings with education. Hatched blocks need a school.": "Parcela dos prédios com educação. Quarteirões hachurados precisam de uma escola.",
  "Share of buildings near a park. Hatched blocks want green space.": "Parcela dos prédios perto de um parque. Quarteirões hachurados querem área verde.",
  "Share of buildings near a stop or station. Hatched blocks need transit.": "Parcela dos prédios perto de ponto ou estação. Quarteirões hachurados precisam de transporte.",
  "Share of buildings with culture. Hatched blocks need a venue.": "Parcela dos prédios com cultura. Quarteirões hachurados precisam de um espaço cultural.",
  "How full each road is, green (free) to red (jammed).": "Ocupação de cada via, de verde (livre) a vermelho (congestionada).",
  "Desirability per tile, from services, parks and industry.": "Atratividade por trecho, por serviços, parques e indústria.",
  "Not reached": "Sem alcance", "Fully served": "Totalmente atendido",
  "Free flow": "Fluxo livre", "Congested": "Congestionado", "Low value": "Valor baixo", "High value": "Valor alto",
  "City average": "Média da cidade", "Facilities": "Instalações", "Capacity": "Capacidade", "Supply": "Oferta",
  "Vehicles": "Veículos", "Congestion": "Congestionamento", "Happiness": "Felicidade", "Riders": "Passageiros",
  "Close info view": "Fechar mapa",
  // service tiers (hints) and usage numbers (src/ui/facility-usage-view.ts)
  "Solar plant: clean power, no smoke (2x2, feeds the road grid)": "Usina solar: energia limpa, sem fumaça (2x2, alimenta a rede das estradas)",
  "Large power plant: high output (2x2, feeds the road grid)": "Usina de grande porte: alta produção (2x2, alimenta a rede das estradas)",
  "Water tower: small supply, no water tile needed (feeds the road grid)": "Reservatório elevado: pouca oferta, não precisa de água por perto (alimenta a rede das estradas)",
  "Large water plant near water (2x2, feeds the road grid)": "Estação de água grande perto da água (2x2, alimenta a rede das estradas)",
  "Fire post: fast local cover (radius 8)": "Posto dos bombeiros: cobertura local rápida (raio 8)",
  "Fire headquarters: 2x2, wide cover (radius 20)": "Quartel central: 2x2, cobertura ampla (raio 20)",
  "In use": "Em uso", "units": "unidades", "Serves": "Atende", "buildings": "prédios", "residents": "moradores", "jobs": "empregos",
  "homes": "casas", "At full capacity": "Na capacidade total", "At full coverage": "Com cobertura total", "Network": "Rede",
  "supply": "oferta", "demand": "demanda", "Not connected to a road": "Sem ligação com estrada",
  "Relays the network, adds no supply": "Repassa a rede, não acrescenta oferta", "Reach": "Alcance", "Whole city": "Cidade inteira",
  "Road network": "Rede das estradas", "Lines": "Linhas", "seats": "lugares", "day": "dia",
  // about and credits (src/ui/credits.ts)
  "About and credits": "Sobre e créditos", "About": "Sobre", "Licences, privacy and acknowledgements": "Licenças, privacidade e agradecimentos",
  "Mayor is an original city builder. It is inspired by classic city-building games but is not affiliated with, sponsored by, or endorsed by Paradox Interactive or Colossal Order.":
    "Mayor é um construtor de cidades original. É inspirado em jogos clássicos de construção de cidades, mas não tem vínculo, patrocínio ou endosso da Paradox Interactive ou da Colossal Order.",
  "Privacy: Mayor collects no data. Cities are saved only on this device; there are no accounts, ads, analytics or tracking.":
    "Privacidade: o Mayor não coleta dados. As cidades ficam salvas só neste aparelho; não há contas, anúncios, análises nem rastreamento.",
  "Third-party materials": "Materiais de terceiros",
  "Some textures, illustrations and the icon were made by the author with the help of AI image tools (Higgsfield, ChatGPT Image, Midjourney) from generic prompts; they are project assets.":
    "Algumas texturas, ilustrações e o ícone foram feitos pelo autor com ajuda de ferramentas de imagem por IA (Higgsfield, ChatGPT Image, Midjourney) a partir de descrições genéricas; são recursos do projeto.",
  "Fable Cities licence notice": "Aviso de licença do Fable Cities", "Version": "Versão",
  "Road props source models": "Modelos de origem dos objetos de rua",
  "Asphalt texture and sky lighting": "Textura de asfalto e iluminação do céu",
  "Ground, road and facade textures": "Texturas de solo, vias e fachadas",
  "Adapted traffic, signal, zoning and rendering code": "Código adaptado de tráfego, semáforos, zoneamento e renderização",
  "3D rendering library": "Biblioteca de renderização 3D", "Native app shell": "Base do aplicativo nativo",
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

/** True when the pt-BR table translates `key` (new UI strings assert this in tests). */
export function hasTranslation(key: string): boolean {
  return PT[key] !== undefined;
}

/** Translate `key`, filling `{name}` placeholders. Unknown keys pass through unchanged. */
export function tr(key: string, vars?: Record<string, string | number>): string {
  let s = lang === "pt" ? PT[key] ?? key : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translate a message coming from the simulation, including its few parametrised ones. */
/** Placement refusals carry what to do instead (docs/process/17-road-snapping.md, "Overlap rules"). */
const REASON_HINT: Record<string, string> = {
  "Overlaps another road": "use Upgrade road to change its class, or draw it parallel, clear of the sidewalk",
  "Crossing angle too sharp": "cross at 20° or more, or end on the road to make a junction",
  "Road already exists here": "use Upgrade road to change its class",
};

export function trReason(reason: string): string {
  const hint = REASON_HINT[reason];
  if (hint) return `${tr(reason)}: ${tr(hint)}`;
  if (lang === "en") return reason;
  const m = /^(.+) must be within 3 tiles of water$/.exec(reason);
  if (m) return `${tr(m[1])} precisa estar a até 3 trechos da água`;
  const u = /^Use only (bus|metro|train) stops$/.exec(reason);
  if (u) return u[1] === "bus" ? "Use apenas pontos de ônibus" : u[1] === "train" ? "Use apenas estações de trem" : "Use apenas estações de metrô";
  return tr(reason);
}

export function monthName(i: number): string {
  return (lang === "pt" ? MONTHS_PT : MONTHS_EN)[i];
}

/** Line names are stored as "Bus 1" / "Metro 2"; show them in the current language. */
export function lineName(stored: string): string {
  const m = /^(Bus|Metro|Train) (\d+)$/.exec(stored);
  if (!m) return stored;
  return lang === "pt" ? `${m[1] === "Bus" ? "Ônibus" : m[1] === "Train" ? "Trem" : "Metrô"} ${m[2]}` : stored;
}
