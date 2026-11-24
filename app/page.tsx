const BOT = "https://t.me/EGolpeBot";

const passos = [
  { n: "1", titulo: "Recebeu algo estranho?", texto: "Uma mensagem pedindo Pix, um link de entrega, um boleto, um aviso do banco." },
  { n: "2", titulo: "Mande para o bot", texto: "Encaminhe a mensagem, cole o texto ou mande um print da tela." },
  { n: "3", titulo: "Receba a resposta", texto: "Em segundos: se é seguro, suspeito ou golpe, por quê, e o que fazer agora." },
];

const golpes = [
  { titulo: "Falso parente", exemplo: "“Oi mãe, troquei de número. Preciso de um Pix hoje.”" },
  { titulo: "Falsa central do banco", exemplo: "“Compra de R$ 2.390 aprovada. Se não reconhece, ligue para…”" },
  { titulo: "Taxa falsa de entrega", exemplo: "“Sua encomenda está retida. Pague a taxa de R$ 9,90 neste link.”" },
  { titulo: "Boleto adulterado", exemplo: "Um boleto que parece certo, mas o dinheiro vai para outra pessoa." },
  { titulo: "Página falsa do governo", exemplo: "“Você tem valores a receber. Pague a taxa para liberar.”" },
];

export default function Home() {
  return (
    <main>
      <header className="topo">
        <p className="selo">Hack Brasil 2026 · Cibersegurança</p>
        <h1>É golpe?</h1>
        <p className="lema">Encaminhe a mensagem suspeita. Receba uma resposta clara, em segundos.</p>
        <a className="botao" href={BOT}>
          Abrir o bot no Telegram
        </a>
        <p className="nota">É grátis. Não precisa instalar nada além do Telegram.</p>
      </header>

      <section aria-labelledby="como">
        <h2 id="como">Como funciona</h2>
        <ol className="passos">
          {passos.map((p) => (
            <li key={p.n}>
              <span className="num" aria-hidden="true">
                {p.n}
              </span>
              <div>
                <h3>{p.titulo}</h3>
                <p>{p.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="exemplo">
        <h2 id="exemplo">Um exemplo de resposta</h2>
        <div className="exemplo">
          <p className="nivel">🔴 Isso é golpe.</p>
          <ul>
            <li>A mensagem diz que é do seu filho, mas vem de um número novo, e o pedido de dinheiro chegou logo depois.</li>
            <li>Há pressa (“hoje”, “senão vai dar juros”), para você agir sem conferir.</li>
          </ul>
          <p className="titulo-passos">O que fazer agora:</p>
          <ol>
            <li>Não faça o Pix.</li>
            <li>Ligue para o número antigo do seu filho e confirme com ele, por voz.</li>
          </ol>
        </div>
        <p className="legenda">Exemplo fictício.</p>
      </section>

      <section aria-labelledby="golpes">
        <h2 id="golpes">Golpes que o bot reconhece</h2>
        <ul className="golpes">
          {golpes.map((g) => (
            <li key={g.titulo}>
              <h3>{g.titulo}</h3>
              <p>{g.exemplo}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="diferente">
        <h2 id="diferente">Por que confiar na resposta</h2>
        <ul className="lista">
          <li>O bot <strong>confere fatos</strong>: há quanto tempo o site existe, se ele imita o site de um banco ou do governo, para onde um link curto leva de verdade, se o telefone é o da central oficial e se os números do boleto batem.</li>
          <li>Ele <strong>só afirma o que consegue mostrar</strong>. Quando não dá para ter certeza, ele diz que é suspeito, nunca que é seguro.</li>
          <li>O que fazer depois vem de <strong>orientações revisadas</strong> para cada tipo de golpe.</li>
        </ul>
      </section>

      <section aria-labelledby="privacidade">
        <h2 id="privacidade">Sua privacidade</h2>
        <ul className="lista">
          <li>As mensagens que você manda <strong>não são guardadas</strong> depois da análise.</li>
          <li>O bot <strong>nunca pede</strong> senha, código de verificação ou dados do banco.</li>
          <li>Cada pessoa pode fazer até 20 análises por hora.</li>
        </ul>
      </section>

      <section className="final">
        <h2>Na dúvida, pergunte antes de pagar.</h2>
        <a className="botao" href={BOT}>
          Abrir o bot no Telegram
        </a>
        <p className="nota">
          Se você já pagou ou clicou, ligue agora para o seu banco pelo número que está no verso do cartão.
        </p>
      </section>

      <footer>
        <p>É golpe? · projeto do Hack Brasil 2026. Todos os exemplos desta página são fictícios.</p>
      </footer>
    </main>
  );
}
