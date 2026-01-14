import re
from typing import List, Tuple
from models import MemoryNode, MemoryLink

class KGExtractor:
    def __init__(self):
        # In a real app, this would use OpenAI/Anthropic
        pass

    def extract(self, text: str, session_id: str) -> Tuple[List[MemoryNode], List[MemoryLink]]:
        """
        Extracts entities and relations from text using a hybrid approach.
        Currently using regex-based extraction for the MVP demonstration.
        """
        # Simple entity extraction (Capitalized words or specific patterns)
        entities = list(set(re.findall(r'\b[A-Z][a-z]+\b', text)))
        nodes = [MemoryNode(id=e.lower(), name=e, session_id=session_id) for e in entities]
        
        # Simple relationship extraction (if entities appear in the same sentence)
        links = []
        sentences = text.split('.')
        for sentence in sentences:
            found_entities = [e.lower() for e in entities if e in sentence]
            if len(found_entities) >= 2:
                for i in range(len(found_entities) - 1):
                    links.append(MemoryLink(
                        source=found_entities[i],
                        target=found_entities[i+1],
                        session_id=session_id
                    ))
        
        return nodes, links

kg_extractor = KGExtractor()
