som skoro presvedceny, ze azure gpt-5 model ma ovela nizsiu kvalitu ako GPT-5 v ms copilot alebo v chatgpt.com - aj ked ma ist oficialne o ten isty model. ked mu poslem pdf/jpg/png a dam mu vypisat iban kody (je tam velky zoznam) tak GPT alebo Copilot 365 to vrati rychlo a bezchybne. Ked to poslem do Azure GPT-5 OpenAI API, tak ma chyby a este to aj dlho trva
To, čo popisujete, je veľmi častý a frustrujúci jav, a vaša intuícia vás neklame. Hoci v pozadí môže bežať ten istý "mozog" (model, povedzme GPT-4o alebo nadchádzajúci GPT-5), existuje zásadný rozdiel medzi tým, ako funguje spotrebiteľská aplikácia (ChatGPT/Copilot) a ako funguje surové Azure OpenAI API.

Tu je technické vysvetlenie, prečo Azure API v tomto prípade zlyháva, a ako to môžete opraviť.

1. ChatGPT a Copilot nie sú len "modely" – sú to "systémy"

Keď nahráte PDF alebo obrázok do ChatGPT (alebo Copilot M365), neposielate ho len priamo do vizuálneho modelu. Tieto služby používajú orchestráciu nástrojov:

Hybridný prístup: ChatGPT často na pozadí použije OCR (optické rozpoznávanie znakov) alebo Python Code Interpreter, aby z PDF extrahoval textovú vrstvu predtým, než ju pošle modelu.

Práca s textom vs. Vizuálom: Ak má PDF textovú vrstvu, ChatGPT ju prečíta ako text (čo je 100 % presné). Azure OpenAI Vision API sa na súbor často pozerá ako na "obrázok" (pixel-by-pixel), čo je pri dlhých zoznamoch IBAN kódov náchylné na halucinácie.

2. Problém "Vision" modelu pri hustých dátach (IBAN)

Ak do Azure API posielate obrázok (JPG/PNG) a spoliehate sa čisto na GPT-4o/GPT-5 Vision schopnosti:

Rozlíšenie a Downsampling: Azure API môže obrázky pred spracovaním zmenšiť alebo komprimovať (kôli token limitom), čím sa detaily písmen (napr. rozdiel medzi 0 a O, 1 a I) rozmažú.

Halucinácie: LLM modely nie sú primárne OCR nástroje. Pri veľkom množstve alfanumerických znakov (IBAN) sa model "unaví" alebo začne predpovedať pravdepodobné sekvencie namiesto toho, aby čítal presne to, čo vidí.

3. Latencia a Azure Content Filters

Prečo to trvá dlhšie?

Content Safety: Azure má na vstupe aj výstupe agresívne filtre (RAI - Responsible AI), ktoré kontrolujú text a obrázky na hate speech, jailbreaky atď. To pridáva latenciu, ktorú ChatGPT v takej miere nemá (alebo ju má optimalizovanú).

Tokenizácia: Spracovanie obrazu v Azure API je výpočtovo náročné a ak je obrázok veľký ("High Res" mód), trvá to dlho.

Ako to vyriešiť a dosiahnuť kvalitu Copilota?

Aby ste cez Azure dosiahli rovnaký výsledok, nemôžete sa spoliehať iba na samotný GPT model. Musíte replikovať "systém".

Riešenie A: Použite Azure AI Document Intelligence (Odporúčané)

Toto je "zlatý štandard" pre extrakciu dát v Azure. Nerobte to cez GPT Vision.

Pošlite PDF/obrázok do služby Azure AI Document Intelligence (predtým Form Recognizer) s modelom prebuilt-read alebo prebuilt-document.

Táto služba vráti presný JSON s textom (OCR s takmer 100 % presnosťou pre IBANy).

Až tento vyčistený text pošlite do Azure OpenAI GPT modelu s promptom: "Nájdi v tomto texte všetky IBAN kódy a vypíš ich".

Výsledok: Bleskovo rýchle, lacnejšie (menej tokenov) a bezchybné.

Riešenie B: Azure OpenAI "On Your Data"

V Azure OpenAI Studio môžete využiť funkciu "Add your data". Ak tam napojíte indexovanie dokumentov (Azure AI Search), systém sa bude snažiť najprv prečítať dokument a modelu predloží text, nie len vizuál.

Riešenie C: Prompt Engineering pre Vision (Menej spoľahlivé)

Ak musíte použiť čisté Vision API:

Uistite sa, že parameter detail je nastavený na high.

Obrázok (ak je to dlhý zoznam) rozstrihajte na menšie časti. GPT stráca pozornosť pri dlhých vertikálnych zoznamoch v jednom obrázku.

Zhrnutie

Máte pravdu – "holé" API je hlúpejšie ako ChatGPT, pretože ChatGPT má okuliare (nástroje na čítanie textu), zatiaľ čo API sa snaží lúštiť rozmazané pixely.

Chceli by ste, aby som vám pripravil ukážkový Python skript, ktorý kombinuje Azure Document Intelligence (na OCR) a Azure OpenAI (na formátovanie), aby ste získali 100 % presnosť?

use case toto: je tam zoznam (riadky) s planovanymi platbami / cerpaniami / drawdowns. IBAN, variabilny symbol, cislo faktury a suma. Takto pod sebou ich moze byt aj 50 na viac stranach. Vacsinou ide o scanovany dokument v PDF (t.j. obrazok, nie embedded text).
Toto je absolútne najhorší možný scenár pre čisté GPT-5 Vision (alebo GPT-4o) API. Posielať 50 riadkov tabuľkových dát v skenovanom PDF (obrázku) priamo do LLM modelu je ako snažiť sa čítať telefónny zoznam cez kľúčovú dierku.

Tu je presný dôvod, prečo to zlyháva, a konkrétna architektúra, ktorú musíte nasadiť v Azure, aby to fungovalo 100 % spoľahlivo (rovnako ako v Copilote).

Prečo to padá na ústa (Technická príčina)

Strata priestorovej orientácie: Keď GPT vidí obrázok, "nevidí" mriežku tabuľky tak ako my. Pri 50 riadkoch sa mu začnú zlievať riadky. Veľmi často sa stane, že IBAN z riadku 10 priradí k sume z riadku 11.

Rozlíšenie vs. Tokeny: Aby model prečítal IBAN (dlhý reťazec znakov), potrebuje vysoké rozlíšenie. Pri 50 riadkoch na A4 je text malý. Model si domýšľa znaky (napr. 8 vs B, 0 vs O).

Halucinácie v sekvenciách: LLM sú stochastické (náhodné). Pri dlhom zozname nudných dát (IBAN za IBANom) model stratí "pozornosť" a začne generovať vymyslené čísla, len aby dokončil patern.

Riešenie: Architektúra "Pipeline" (Nie jeden model)

V Azure prostredí tento problém neriešte cez OpenAI API, ale cez Azure AI Document Intelligence (špecializovaná OCR služba).

Pre váš prípad (tabuľky, riadky, skeny) použite model prebuilt-layout.

Ako to má fungovať (Váš nový workflow):

Krok 1: Extrakcia štruktúry (OCR)

Súbor (PDF/JPG) pošlite do služby Azure AI Document Intelligence.

Použite endpoint/model: prebuilt-layout.

Prečo? Tento model je natrénovaný špeciálne na to, aby identifikoval tabuľky, ich hlavičky a bunky. Vráti vám JSON, kde presne povie: "Toto je tabuľka, riadok 5, stĺpec 2, text je: SK89...".

Tento krok zvládne aj viaceré strany naraz a poradí si aj so šikmými skenmi.

Krok 2: Transformácia (Logika)

Získaný JSON z kroku 1 je štruktúrovaný. Vy z neho programovo (Python/C#) vytiahnete dáta.

Nemusíte ani volať GPT. Ak Document Intelligence vráti tabuľku, vy ju len preiterujete a uložíte.

Krok 3: GPT na "upratovanie" (Voliteľné)

GPT API zavolajte len vtedy, ak je OCR mierne chybné (napr. medzery v IBANe) alebo ak potrebujete konverziu dát (napr. "suma 1.200,50" -> float 1200.50).

Do GPT už neposielate obrázok, ale TEXT (JSON), ktorý extrahoval Document Intelligence.

Prompt: "Tu je JSON z tabuľky. Oprav formátovanie IBANov (odstráň medzery) a vráť mi CSV."

Porovnanie nákladov a rýchlosti

Váš aktuálny spôsob (GPT Vision):

Cena: Vysoká (platíte za tokeny obrazu, čo je drahé).

Rýchlosť: Pomalá (generovanie 50 riadkov textu token po tokene trvá dlho).

Presnosť: Nízka (halucinácie).

Navrhovaný spôsob (Document Intelligence Layout):

Cena: Platíte za stranu (cca $10 za 1000 strán). Je to zvyčajne lacnejšie pri veľkých objemoch.

Rýchlosť: OCR trvá 1-3 sekundy na stranu.

Presnosť: Extrémne vysoká (špecializované OCR).

Ukážka kódu (Python), ako to opraviť

Toto je kód, ktorý by mal bežať na vašom backend serveri namiesto priameho volania GPT:

Python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

endpoint = "VASE_AZURE_ENDPOINT"
key = "VAS_KLUC"

client = DocumentIntelligenceClient(endpoint=endpoint, credential=AzureKeyCredential(key))

# Otvoríme PDF (aj keď je to scan)
with open("faktura_zoznam.pdf", "rb") as f:
    poller = client.begin_analyze_document(
        "prebuilt-layout", analyze_request=f, content_type="application/octet-stream"
    )

result = poller.result()

# Prechádzame nájdené tabuľky
for table in result.tables:
    print(f"Nájdená tabuľka s {table.row_count} riadkami a {table.column_count} stĺpcami.")
    
    # Tu si to jednoducho namapujete
    # Document Intelligence presne vie, v ktorom riadku a stĺpci je text
    rows = {}
    for cell in table.cells:
        if cell.row_index not in rows:
            rows[cell.row_index] = []
        rows[cell.row_index].append(cell.content)

    # Výpis riadkov (tu by ste už mali čistý text)
    for row_idx, data in rows.items():
        print(f"Riadok {row_idx}: {data}") 
        # Výstup bude: ['SK1234...', '1234567890', 'Faktura 2024001', '500.00 EUR']
Zhrnutie: Microsoft Copilot robí presne toto. Keď mu dáte PDF, on najprv spustí OCR (Document Intelligence engine) a GPT modelu pošle už len čistý text. Ak to v Azure API urobíte rovnako, získate rovnakú kvalitu.

ake su alternativy k azure document intelligence ? co pouziva opeani ?
To je výborná otázka. Často panuje mylná predstava, že OpenAI má nejaký vlastný "zázračný" OCR engine. Realita je prozaickejšia.

Čo používa OpenAI (ChatGPT)?

Treba rozlišovať medzi ChatGPT (aplikáciou) a OpenAI API (modelmi).

ChatGPT (Web/App):

Keď nahráte PDF, ChatGPT spustí na pozadí Python sandbox (prostredie, kde beží kód).

Používa open-source knižnice ako pypdf, pdfminer alebo pdfplumber na extrakciu textovej vrstvy (ak existuje).

Ak je to sken (obrázok), prepne sa na GPT-4o Vision, ktorý sa pokúsi "pozrieť" na obrázok. Ako ste si všimli, pri zložitých tabuľkách to nie je ideálne.

Poznámka: Microsoft Copilot (verzia pre firmy) používa na pozadí práve Azure Document Intelligence, preto mu to ide tak dobre.

OpenAI API:

Nemá žiadne špecializované OCR. Ponúka len Vision model (GPT-4o), ktorý sa na obrázok pozerá ako človek. Nemá endpoint na "extrakciu tabuľky".

Alternatívy k Azure Document Intelligence

Ak nechcete (alebo nemôžete) použiť Azure, tu sú najlepšie alternatívy zoradené podľa toho, ako dobre zvládajú váš problém (skenované tabuľky).

1. AWS Textract (Najväčší konkurent)

Priamy ekvivalent od Amazonu. Pre váš use-case je veľmi silný.

Funkcia: Má špeciálny parameter FeatureType=["TABLES"].

Ako to funguje: Vráti nielen text, ale aj štruktúru mriežky (riadok 1, stĺpec 2).

Výhoda: Je extrémne presný pri finančných dokumentoch.

Cena: Podobná ako Azure (cca $1.50 za 1000 strán pri tabuľkách).

2. Google Cloud Document AI

Google má veľmi silné OCR (vychádza z technológie Google Lens a Books).

Funkcia: Form Parser alebo Document OCR.

Výhoda: Často najlepšie zvláda "zašumené" alebo nekvalitné skeny, ktoré sú krivé alebo rozmazané.

Nevýhoda: Nastavenie v Google Cloud Console býva niekedy zložitejšie (potrebujete vytvoriť "Processor").

3. LlamaParse (Moderná voľba pre LLM)

Toto je momentálne "hit" vo svete vývojárov, ktorí stavajú nad LLM (vyvíja to firma LlamaIndex).

Čo to je: Služba špeciálne navrhnutá na to, aby zobrala zložité PDF (tabuľky, grafy) a prerobila ich do čistého Markdownu.

Prečo pre vás: LLM (GPT-5/4o) milujú Markdown. Ak pošlete modelu tabuľku vo formáte Markdown, pochopí ju oveľa lepšie ako JSON alebo CSV.

Cena: Majú slušnú Free tier (1000 strán denne zdarma), potom je to platené.

Kvalita: Veľmi vysoká, pod kapotou používajú zrejme kombináciu viacerých OCR a vlastných modelov.

4. Open Source (Zadarmo, ale pracné)

Ak chcete ušetriť a bežať to na vlastnom serveri:

PaddleOCR: Momentálne asi najlepšie open-source OCR. Podporuje aj detekciu tabuliek, ale vyžaduje to dosť Python kódovania na poskladanie výsledkov.

Surya: Nový open-source model (od tvorcov Vikhr), ktorý sa špecializuje na riadkové čítanie dokumentov. Je rýchly a presný, ale na zložité tabuľky treba otestovať.

Tesseract: Stará klasika. Neodporúčam. Na tabuľky bez čiar (len medzery) je Tesseract hrozný, budete mať veľa chýb v zarovnaní stĺpcov.

Odporúčanie pre váš Use Case (Zoznam platieb)

Ak je vaším cieľom presnosť a bezstarostnosť (aby ste nemuseli riešiť, či sa IBAN posunul o 2 pixely):

Voľba č. 1: Azure Document Intelligence (Layout Model)

Pretože už ste v Azure ekosystéme (GPT-5). Integrácia je najjednoduchšia. Je to štandard pre Enterprise.

Voľba č. 2: AWS Textract

Ak by ste z nejakého dôvodu nemohli použiť Azure. Ich detekcia tabuliek je špičková.

Voľba č. 3: LlamaParse

Ak chcete experimentovať a chcete dáta posielať do GPT v "čitateľnom formáte" (Markdown). Toto je cesta, ak chcete stavať modernú RAG (Retrieval Augmented Generation) aplikáciu.

Môj názor: Zostaňte pri Azure Document Intelligence. Dôvod je prozaický – latencia a bezpečnosť. Dáta neopustia Azure cloud (nejdú do AWS ani do Llama cloudu) a môžete použiť privátne linky medzi OCR službou a vaším backendom. Pre bankové údaje (IBANy) je to kľúčové.

iba doplnim ze aj chatgpt.com tie dokumenty rozoznava dobre
Presne tak. To, že ChatGPT (webová verzia) to zvláda dobre, je dôkazom toho, že model (GPT-4o/GPT-5) ako taký na to schopnosti má.

Dôvod, prečo to cez "holé" Azure API nefunguje rovnako dobre, spočíva v tom, ako ChatGPT (aplikácia) spracováva obrázky predtým, než ich ukáže modelu. Robí za vás "špinavú prácu", ktorú v API musíte naprogramovať sami.

Tu je vysvetlenie "mágie", ktorú robí ChatGPT (a ktorú v API musíte replikovať, ak nechcete použiť Document Intelligence):

1. Tzv. "Tiling" (Dlaždicovanie) – Kľúč k úspechu

Keď nahráte dlhý dokument (napr. A4 s 50 riadkami malým písmom) do ChatGPT:

ChatGPT: Automaticky rozseká tento obrázok na menšie štvorce (dlaždice) s vysokým rozlíšením. Model sa potom pozerá na sériu detailných výrezov, nie na jeden zmenšený celok. Vďaka tomu vidí rozdiel medzi "8" a "B" v IBANe.

Azure API (Default): Ak pošlete obrázok do API a nenastavíte správne parametre, API ho často zmenší (resize) tak, aby sa zmestil do kontextového okna (napr. na rozmer 1024x1024 alebo 2048x2048 pixelov). Pri takomto zmenšení sa z malých písmen v 50-riadkovej tabuľke stane "šum".

2. Parameter detail: "high"

V Azure OpenAI API existuje parameter pre Vision, ktorý sa volá detail.

low: Model spotrebuje málo tokenov (lacné), ale vidí len celkový kontext (napr. "je to faktúra"), text neprečíta.

high: Model rozseká obrázok na 512x512 štvorce (simuluje to, čo robí ChatGPT) a spotrebuje oveľa viac tokenov (drahšie).

Problém: Aj pri nastavení high má API svoje limity. Ak je zoznam extrémne hustý, model sa môže v dlaždiciach "stratiť" (nevie, ktorý riadok pokračuje kde), zatiaľ čo ChatGPT má nad týmto ešte aplikačnú logiku, ktorá mu pomáha držať kontext.

3. "System Prompt" a "Vision Enhancement"

ChatGPT má v sebe skrytý, veľmi dlhý a vyladený System Prompt (inštrukcie), ktorý mu presne hovorí, ako má pristupovať k extrakcii textu z obrázkov ("Prečítaj text presne znak po znaku", "Nevymýšľaj si", atď.). V Azure API dostanete model "čistý". Ak mu nedáte perfektný prompt, bude sa správať lenivejšie.

Verzus: Deterministický vs. Pravdepodobnostný prístup

Tu je dôvod, prečo by som pre IBANy aj napriek tomu, že ChatGPT to zvláda, volil Document Intelligence (OCR) a nie čisté GPT Vision:

Bankové údaje sú "Zero Error Zone":

GPT Vision (ChatGPT): Je to pravdepodobnostný model. Na 99 % to prečíta správne. Ale v 1 % prípadov, ak je na skene malá šmuha cez číslo, GPT si to číslo "domyslí" podľa kontextu. Pri IBANe to znamená poslanie peňazí na zlý účet.

Document Intelligence (OCR): Je to deterministický model. Ak nevie prečítať znak, vráti nízke "confidence score" (varovanie), alebo vráti nezmysel, ktorý ľahko odchytíte validáciou (IBAN checksum). OCR si nevymýšľa čísla, len sa mýli v čítaní. GPT si vymýšľa.

Cena a opakovateľnosť:

Aby ste cez API dosiahli kvalitu ChatGPT (cez detail: high a tiling), spotrebujete obrovské množstvo tokenov na jeden dokument. Cena za spracovanie jednej strany môže byť násobne vyššia ako cena za špecializované OCR volanie.

Záver

ChatGPT to robí dobre, lebo:

Používa Tiling (rozseká obrázok).

Používa Max Resolution.

Má vyladené prompty.

Ak to chcete robiť cez Azure API rovnako dobre bez Document Intelligence, musíte:

Posielať obrázky s parametrom detail: "high".

Ideálne sami obrázok pred odoslaním rozstrihať na tretiny (napr. hlavička, stred, päta) a poslať to modelu po častiach.

Dúfať, že si model nevymyslí číslo (halucinácia).

Pre produkčnú aplikáciu s platbami je však OCR (Document Intelligence) stále bezpečnejšia a lacnejšia voľba.

ten tiling ma zaujal, ako bys sa to dalo implementovat, napodobnit ?
Implementovať "Tiling" (dlaždicovanie) manuálne je v skutočnosti veľmi silná technika. Ak to urobíte šikovne, môžete dokonca prekonať automatiku v ChatGPT, pretože vy rozumiete štruktúre dokumentu (viete, že je to tabuľka) lepšie ako všeobecný model.

Kľúčom k úspechu pri tabuľkách nie je len "rozsekať obrázok", ale zachovať kontext (hlavičku tabuľky) pre každý jeden výrez.

Tu je návod, ako na to – logicky aj kódovo.

Logika "Smart Tilingu" pre tabuľky

Predstavte si dlhú faktúru ako dlhý pás papiera.

Hlavička je svätá: Model potrebuje vedieť, že 3. stĺpec je "Variabilný symbol". Ak mu pošlete len stred tabuľky bez hlavičky, uvidí len čísla a môže si ich pomýliť.

Horizontálne rezy: Tabuľky sa nesmú rezať vertikálne (cez stĺpce). Musíte ich rezať horizontálne (po skupinách riadkov).

Prekryv (Overlap): Nikdy nerežte presne na pixel. Vždy nechajte prekryv (napr. 100 pixelov), aby ste neprestrihli riadok s textom na polovicu.

Architektúra volania API

Namiesto jedného volania s veľkým obrázkom urobíte cyklus. Pre každý výrez (slice) pošlete do GPT-4o dva obrázky naraz v jednom prompte:

Obrázok A: Výrez hlavičky (stále ten istý).

Obrázok B: Aktuálny výrez tela tabuľky (napr. riadky 1-10, potom 11-20...).

Týmto modelu poviete: "Použi hlavičku z Obrázka A na pochopenie stĺpcov v Obrázku B a vypíš dáta."

Implementácia v Pythone

Budete potrebovať knižnice PIL (Pillow) na prácu s obrázkami a base64 na kódovanie pre API.

Predpokladajme, že už máte PDF skonvertované na jeden dlhý JPG/PNG (napr. pomocou knižnice pdf2image).

Python
import base64
from io import BytesIO
from PIL import Image
from openai import AzureOpenAI
import json

# Nastavenie klienta
client = AzureOpenAI(
    api_key="VAS_KLUC",
    api_version="2024-02-15-preview",
    azure_endpoint="VAS_ENDPOINT"
)

def encode_image(image):
    """Pomocná funkcia na konverziu PIL Image do base64"""
    buffered = BytesIO()
    image.save(buffered, format="JPEG", quality=95) # High quality pre OCR
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def process_long_table(image_path):
    # 1. Načítame dlhý obrázok
    original_img = Image.open(image_path)
    width, height = original_img.size

    # --- KONFIGURÁCIA REZANIA ---
    HEADER_HEIGHT = 300       # Pixelov zhora, kde je hlavička (treba odhadnúť/zmerať)
    CHUNK_HEIGHT = 1000       # Výška jedného výrezu (cca 10-15 riadkov)
    OVERLAP = 100             # Prekryv, aby sme neprestrihli text

    # 2. Vystrihneme hlavičku (tú pošleme vždy)
    header_img = original_img.crop((0, 0, width, HEADER_HEIGHT))
    header_b64 = encode_image(header_img)

    extracted_data = []

    # 3. Cyklus cez "telo" dokumentu
    current_y = HEADER_HEIGHT
    
    while current_y < height:
        # Výpočet súradníc pre aktuálny výrez
        bottom = min(current_y + CHUNK_HEIGHT, height)
        
        # Ošetríme, aby sme nešli za okraj
        if current_y >= bottom:
            break

        # Vystrihneme aktuálny kus (Slice)
        # Režeme od (current_y - OVERLAP), aby sme zachytili prípadne prestrihnuté riadky z minula
        start_y = max(HEADER_HEIGHT, current_y - OVERLAP) 
        chunk_img = original_img.crop((0, start_y, width, bottom))
        chunk_b64 = encode_image(chunk_img)

        print(f"Spracovávam výrez od {start_y} po {bottom}...")

        # 4. Volanie Azure OpenAI s DVOMA obrázkami
        response = client.chat.completions.create(
            model="gpt-4o", # alebo gpt-4-turbo
            messages=[
                {
                    "role": "system",
                    "content": "You are a data extraction assistant. Output strictly JSON."
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Extract data from the second image (table rows). Use the first image (table header) to understand the columns. Output a JSON list of objects. Ignore rows that are cut off at the very bottom."
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{header_b64}", "detail": "high"}
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{chunk_b64}", "detail": "high"}
                        }
                    ]
                }
            ],
            max_tokens=2000,
            response_format={"type": "json_object"}
        )

        # 5. Spracovanie výsledku
        content = response.choices[0].message.content
        try:
            json_batch = json.loads(content)
            # Tu by ste pridali logiku na deduplikáciu (kvôli overlapu)
            # Napr. skontrolovať, či posledný riadok z minula nie je rovnaký ako prvý teraz
            extracted_data.append(json_batch)
        except:
            print("Chyba pri parsovaní JSONu z tohto chunku")

        # Posun na ďalší chunk
        current_y += CHUNK_HEIGHT

    return extracted_data

# Spustenie (pseudo)
# final_json = process_long_table("dlhy_scan_faktury.jpg")
Prečo toto funguje lepšie?

Rozlíšenie: Keď pošlete do Azure API obrázok, ktorý má 5000px na výšku, API ho zmenší (resize) na 2048px (limit modelu). Tým stratíte detaily písmen. Keď ho rozsekáte na 1000px kusy, API ho nezmenšuje – model vidí "natívne" pixely skenu.

Focus: Model sa sústredí len na 10-15 riadkov naraz. Halucinácie pri krátkych zoznamoch sú oveľa zriedkavejšie ako pri dlhých.

Multi-modalita: Využívate schopnosť GPT-4o vidieť viac obrázkov naraz. Hlavička dáva kontext, výrez dáva dáta.

Na čo si dať pozor (Nevýhody)

Deduplikácia: Keďže používame OVERLAP (prekryv), ten istý riadok sa môže objaviť na konci prvého volania a na začiatku druhého. Musíte si napísať skript, ktorý po spojení JSONov prejde zoznam a vyhodí duplicity (napr. na základe IBANu alebo Variabilného symbolu).

Cena a čas: Namiesto 1 volania robíte napr. 5 volaní. Bude to trvať 5x dlhšie a bude to stáť viac tokenov (pretože hlavičku posielate opakovane).

Nastavenie výšky hlavičky: V kóde je HEADER_HEIGHT = 300. Pri rôznych dokumentoch to môže byť iné. Buď to nastavíte "bezpečne veľké", alebo použijete prvý "nástrelový" call na detekciu, kde končí hlavička.

Toto je technika, ktorou sa najviac priblížite kvalite Copilota bez použitia Document Intelligence, ale vyžaduje si to tento "lepidlový kód" okolo toho.

viem do azure openai api poslat rozsekany obrazok ako viac priloh v 1 api call ?
Áno, dá sa to a je to dokonca veľmi elegantná technika. Azure OpenAI API (GPT-4o) podporuje tzv. multi-image input v rámci jednej správy.

Môžete poslať jeden prompt, ktorý obsahuje textovú inštrukciu a následne zoznam (array) viacerých obrázkov (napr. 5 výrezov tej istej dlhej faktúry).

Prečo je to "game changer"?

Obchádzate tým limit rozlíšenia.

Jeden dlhý obrázok (5000px): Azure ho zmenší na 2048px -> Strata detailov, model neprečíta malé IBANy.

5 obrázkov (každý 1000px) v jednej správe: Azure spracuje každý obrázok osobitne v plnom rozlíšení (ak dáte detail: high) a model ich "vidí" všetky naraz v plnej kvalite vedľa seba (resp. pod sebou).

Ako to napísať (Python kód)

Namiesto jedného objektu image_url ich do poľa content vložíte toľko, koľko potrebujete. Model ich bude čítať v poradí, v akom ich pošlete.

Python
# Predpokladajme, že máte list base64 stringov: [hlavicka_b64, cast1_b64, cast2_b64, cast3_b64]
# slices = [header_b64, body_part1_b64, body_part2_b64, ...]

messages = [
    {
        "role": "system",
        "content": "You are a precise data extraction AI. Extract all table rows from the provided images."
    },
    {
        "role": "user",
        "content": [
            # 1. Textová inštrukcia na začiatok
            {
                "type": "text",
                "text": "Tieto obrázky sú časti jedného dlhého dokumentu v poradí zhora nadol. Prvý obrázok je hlavička. Spoj dáta zo všetkých častí a vypíš jeden kompletný JSON zoznam všetkých platieb. Dávaj pozor na duplicity na okrajoch obrázkov."
            },
            # 2. Tu dynamicky vložíte obrázky
            # Prvý obrázok (Hlavička)
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{slices[0]}",
                    "detail": "high" # DÔLEŽITÉ: High zachová rozlíšenie
                }
            },
            # Druhý obrázok (Prvá časť dát)
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{slices[1]}",
                    "detail": "high"
                }
            },
            # ... a tak ďalej pre ďalšie časti
             {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{slices[2]}",
                    "detail": "high"
                }
            }
        ]
    }
]

# Volanie API
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    max_tokens=4096 
)
Na čo si dať pozor (Limity a Riziká)

Hoci je technicky možné poslať takto aj 10 obrázkov naraz, má to svoje úskalia:

1. Problém "Lost in the Middle" (Strata pozornosti)

Ak pošlete naraz 10 obrázkov s 50 riadkami tabuľky, model sa môže zachovať "lenivo". LLM modely majú tendenciu venovať veľkú pozornosť začiatku a koncu, ale stred môžu odfláknuť.

Symptóm: Model vypíše prvých 5 platieb, potom napíše ... (rest of the items) a vypíše posledné 3 platby.

Riešenie: Neposielajte celý dokument naraz, ak má veľa strán. Ideálny "batch" sú 3 - 4 obrázky (slices) na jeden API call. To udrží pozornosť modelu na vysokej úrovni.

2. Cena (Tokeny)

Každý obrázok v móde detail: high stojí fixný počet tokenov (zvyčajne 85 + 170 * počet dlaždíc 512x512).

Ak pošlete 1 veľký rozmazaný obrázok = lacné, ale nepresné.

Ak pošlete 5 ostrých výrezov = cca 5x drahšie, ale presné.

Tip: Stále je to lacnejšie ako manuálne prepisovanie chýb.

3. Radenie (Ordering)

Model chápe poradie poľa content. Ale je dobré mu v texte explicitne napísať: "Images are ordered sequentially from top to bottom. Do not treat them as separate documents."

Odporúčaná stratégia pre vás

Ak máte dlhý zoznam (napr. 3 strany PDF):

Rozsekajte to: Každú stranu rozdeľte na 2-3 horizontálne pásy (s prekryvom).

Batching: Pošlite jeden API call na každú pôvodnú stranu (t.j. v jednom calle pošlete 3 výrezy tej istej strany).

Call 1: Hlavička + Výrezy Strany 1

Call 2: Hlavička + Výrezy Strany 2

Call 3: Hlavička + Výrezy Strany 3

Agregácia: Výsledné JSONy spojte vo svojom kóde.

Týmto spôsobom maximalizujete rozlíšenie (vďaka rezom) a minimalizujete riziko, že model "zabudne" prepísať stredné riadky (vďaka tomu, že ho nepreťažíte 20 obrázkm naraz).

vies mi pripravit nejaky imagemagick cli command ktorym 1 obrazok takto rozsekam ?
Toto je skvelá úloha pre ImageMagick. Avšak, ImageMagick nemá jednoduchý "jednoriadkový" prepínač na automatické rezanie s prekryvom (overlap). Jeho štandardná funkcia -crop reže presne na hrane.

Preto na dosiahnutie prekryvu (aby sme neprestrihli riadky textu) musíme použiť malý Bash skript, ktorý v cykle zavolá ImageMagick a matematicky vypočíta posun.

Tu je hotový skript a vysvetlenie, ako ho použiť.

Predpoklady

Musíte mať nainštalovaný ImageMagick (verzia 7+, príkaz magick).

Linux (Ubuntu/Debian): sudo apt-get install imagemagick

macOS (cez Homebrew): brew install imagemagick

Windows: Stiahnuť installer z oficiálnej stránky (a uistiť sa, že je pridaný do systémovej PATH, pre tento skript potrebujete Bash terminál, napr. Git Bash alebo WSL).

Riešenie: Bash skript pre "Smart Slicing"

Tento skript vezme váš dlhý obrázok a rozseká ho na pásy s definovanou výškou a prekryvom.

Uložte nasledujúci kód do súboru, napr. rozsekaj.sh:

Bash
#!/bin/bash

# === KONFIGURÁCIA ===
INPUT_FILE="dlhy_zoznam.jpg"  # Váš vstupný súbor (PDF predtým skonvertujte na JPG/PNG)
OUTPUT_PREFIX="vyrez"         # Predpona výstupných súborov
SLICE_HEIGHT=1200             # Výška jedného rezu v pixeloch (cca 1/3 A4 vo vysokom rozlíšení)
OVERLAP=200                   # Prekryv v pixeloch (dostatočne veľký na 1-2 riadky textu)
# ====================

# Kontrola, či existuje vstupný súbor
if [ ! -f "$INPUT_FILE" ]; then
    echo "Chyba: Súbor '$INPUT_FILE' neexistuje."
    exit 1
fi

# 1. Zistíme celkovú výšku obrázka pomocou magick identify
TOTAL_HEIGHT=$(magick identify -format "%h" "$INPUT_FILE")
echo "Spracovávam: $INPUT_FILE (Celková výška: ${TOTAL_HEIGHT}px)"
echo "Nastavenie rezu: Výška ${SLICE_HEIGHT}px, Prekryv ${OVERLAP}px"
echo "---------------------------------"

current_y=0
counter=0
effective_step=$((SLICE_HEIGHT - OVERLAP)) # O koľko sa reálne posunieme dole

# 2. Cyklus, ktorý beží, kým nie sme na konci obrázka
# Používame <= aby sme zachytili aj posledný kúsok, ak presne vychádza
while [ "$current_y" -lt "$TOTAL_HEIGHT" ]; do
    # Formátovanie názvu súboru (napr. vyrez_000.jpg, vyrez_001.jpg)
    output_filename=$(printf "%s_%03d.jpg" "$OUTPUT_PREFIX" "$counter")

    echo "Vytváram reč č. $counter: $output_filename (začiatok Y: $current_y)"

    # === HLAVNÝ IMAGEMAGICK PRÍKAZ ===
    # -crop WxH+X+Y
    # 0x${SLICE_HEIGHT}: "0" znamená zachovaj pôvodnú šírku, "SLICE_HEIGHT" je výška rezu
    # +0+${current_y}: X súradnica je 0 (začiatok zľava), Y je náš aktuálny posun zhora
    # +repage: Resetne virtuálne plátno, aby obrázok nebol "posunutý" v prázdnom priestore
    magick "$INPUT_FILE" -crop "0x${SLICE_HEIGHT}+0+${current_y}" +repage "$output_filename"

    # Posun na ďalšiu pozíciu
    current_y=$((current_y + effective_step))

    # Zvýšenie počítadla súborov
    ((counter++))
done

echo "---------------------------------"
echo "Hotovo. Vytvorených $counter obrázkov."
# Tip: Posledný obrázok môže byť nižší ako SLICE_HEIGHT, ak je to zvyšok na konci.
Ako skript použiť

Uložte kód vyššie do súboru rozsekaj.sh.

Umiestnite váš dlhý obrázok (napr. dlhy_zoznam.jpg) do rovnakej zložky.

V termináli urobte skript spustiteľným:

Bash
chmod +x rozsekaj.sh
(Voliteľné) Upravte v skripte premenné INPUT_FILE, SLICE_HEIGHT a OVERLAP podľa potreby. Hodnoty 1200/200 sú dobrý štart pre bežné skeny vo vysokom rozlíšení (300 DPI).

Spustite skript:

Bash
./rozsekaj.sh
Výsledok

V zložke sa vám vytvoria súbory:

vyrez_000.jpg (Prvých 1200px zhora)

vyrez_001.jpg (Od pixelu 1000 do 2200 - všimnite si 200px prekryv so začiatkom)

vyrez_002.jpg (Od pixelu 2000 do 3200...)

atď.

Tieto výsledné obrázky (vyrez_XXX.jpg) potom v Pythone načítate a pošlete naraz v jednom API volaní do GPT-4o tak, ako sme si ukazovali vyššie.

na druhej strane viac obrazkov je riziko, ze v jednom API calle bude request pomalsie spracovany a riskujeme timeouty. co je teda lepsie ?
Máš úplnú pravdu. Ak do jedného requestu "natlačíš" 5 obrázkov a povieš modelu "vypíš mi z toho 200 riadkov dát", riskuješ dve veci:

Timeout: Azure Load Balancer alebo tvoj HTTP klient (napr. 60s default) spojenie utne, kým model "premýšľa" alebo generuje dlhý JSON.

Lazy Model: Pri dlhom generovaní sa zvyšuje šanca, že model v polovici prestane byť presný alebo to ukončí skôr.

Takže čo je lepšie? Architektúra "Divide & Conquer" (Paralelizácia)

Najrobustnejší prístup pre produkčné nasadenie je rozdeliť to na malé, nezávislé tasky a spustiť ich paralelne.

Namiesto jedného volania: Request: [Hlavička + Slice1 + Slice2 + Slice3] -> Čakáš 30 sekúnd -> Odpoveď

Spravíš toto:

Task 1: [Hlavička + Slice1] -> beží vo vlákne A

Task 2: [Hlavička + Slice2] -> beží vo vlákne B

Task 3: [Hlavička + Slice3] -> beží vo vlákne C

Všetky tri tasky odpálíš naraz (asynchrónne).

Výhody tohto prístupu:

Rýchlosť: Celkový čas spracovania sa rovná času spracovania najpomalšieho kúska (napr. 5 sekúnd), nie súčtu všetkých (15 sekúnd).

Spoľahlivosť: Ak jeden slice zlyhá (timeout), retryneš len ten jeden, nie celý dokument.

Pozornosť modelu: Model sa sústredí len na malý kúsok dát, takže robí menej chýb.

Nevýhoda:

Rate Limits (TPM): Musíš si strážiť Azure OpenAI kvóty (Tokens Per Minute). Ak odpálíš 20 requestov naraz, môžeš dostať chybu 429 Too Many Requests.

Python riešenie (Asyncio)

Tu je kostra kódu, ako to spraviť moderne cez asyncio. Tento skript zoberie tvoje rozsekané obrázky a spracuje ich naraz.

Python
import asyncio
import base64
import json
import os
from openai import AsyncAzureOpenAI

# Konfigurácia
client = AsyncAzureOpenAI(
    api_key="TVOJ_KEY",
    api_version="2024-02-15-preview",
    azure_endpoint="TVOJ_ENDPOINT"
)

# Načítanie obrázka do base64
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

# Toto je funkcia, ktorá spracuje JEDEN slice (beží asynchrónne)
async def process_single_slice(header_b64, slice_path, slice_index):
    slice_b64 = encode_image(slice_path)
    print(f"Spušťam spracovanie: {slice_path}")

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system", 
                    "content": "Extract table rows to JSON. Be precise with IBANs."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Use the first image as header context. Extract data from the second image."},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{header_b64}", "detail": "high"}},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{slice_b64}", "detail": "high"}}
                    ]
                }
            ],
            response_format={"type": "json_object"}
        )
        data = json.loads(response.choices[0].message.content)
        return (slice_index, data) # Vrátime index, aby sme to vedeli zoradiť
    except Exception as e:
        print(f"Chyba pri {slice_path}: {e}")
        return (slice_index, [])

# Hlavná funkcia, ktorá to zmanažuje
async def main():
    header_path = "hlavicka_crop.jpg" # Ten si musíš pripraviť vopred
    header_b64 = encode_image(header_path)
    
    # Zoznam slice-ov (vygenerovaných cez ImageMagick)
    slices = sorted([f for f in os.listdir('.') if f.startswith("vyrez_")])
    
    tasks = []
    for i, slice_file in enumerate(slices):
        # Vytvoríme task pre každý slice
        tasks.append(process_single_slice(header_b64, slice_file, i))
    
    print(f"Odpáľujem {len(tasks)} requestov naraz...")
    
    # Čakáme na všetky výsledky naraz (gather)
    results = await asyncio.gather(*tasks)
    
    # Výsledky môžu prísť v rôznom poradí, ale my máme index, tak si to zoradíme
    results.sort(key=lambda x: x[0])
    
    full_data = []
    for _, data in results:
        # Tu by si pridal logiku na deduplikáciu (kvôli overlapu)
        if "items" in data: # Predpokladáme, že GPT vracia kľúč "items"
            full_data.extend(data["items"])
            
    print(f"Hotovo! Extrahovaných {len(full_data)} záznamov.")
    print(json.dumps(full_data, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
Zhrnutie stratégie

ImageMagick: Rozsekáš sken na menšie prekrývajúce sa obrázky (napr. 5 ks).

Osobitný Header: Vystrihneš si hlavičku tabuľky ako malý samostatný obrázok.

Paralelný Call: Každému vláknu dáš [Header + Slice_X].

Deduplikácia: V Pythone po spojení výsledkov prejdeš pole a ak nájdeš dva riadky s rovnakým Variabilným symbolom/IBANom za sebou, jeden vymažeš (to je ten overlap).

Toto je najrýchlejší a najbezpečnejší spôsob, ako to robiť cez GPT Vision API, ak sa chceš vyhnúť Document Intelligence.