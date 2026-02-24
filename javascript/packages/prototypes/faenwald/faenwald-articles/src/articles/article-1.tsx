import { Divider, H2, Img, ImgVariant, ImgWrapper, Page, Section, Subtitle, Text, Title } from "@/ui-lib";
import { router } from "@/route.ts";
import articleContent from "./text.json";
import "./article-1.css";

const isImageInsert = (text: string | string[]): text is ["image", string, ImgVariant] => {
  return Array.isArray(text) && text[0] === "image";
}

const isImageWithDescriptionInsert = (text: string | string[]): text is ["image-with-description", string, ImgVariant, string] => {
  return Array.isArray(text) && text[0] === "image-with-description";
}

const Article1 = () => {
  return (
    <Page>
      <Title>
        {articleContent.title}
      </Title>

      <Divider/>

      {articleContent["3-section"].map((section, idx) => (
        <Section key={idx}>
          <H2>
            {section.title}
          </H2>


          <div>
            {
              section.text.map((text, idx) => {
                if (isImageInsert(text)) {
                  return <Img key={idx} className={text[1]} variant={text[2]}/>;
                }
                if (isImageWithDescriptionInsert(text)) {
                  return (
                    <ImgWrapper key={idx}>
                      <Img className={text[1]} variant={text[2]}/>

                      <Subtitle>{text[3]}</Subtitle>
                    </ImgWrapper>
                  );
                }

                return <Text key={idx}>{text}</Text>;
              })
            }
          </div>
        </Section>
      ))}
    </Page>
  )
};

router.registerRoute("/article-one", Article1);
