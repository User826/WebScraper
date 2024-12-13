import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  imports: [CommonModule],
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.css'] // Fix to styleUrls instead of styleUrl
})
export class CardComponent implements OnChanges {
  @Input() searchResults: {
    title: string,
    imageUrl: string,
    price: string,
    lowestEbayPrice: string,
    lowestGuitarPrice: string,
    lowestAliExpressPrice: string,
    bestPrice: string,
    bestPriceUrl: string
  }[] = [];

  showArrows: boolean = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['searchResults']) {
      this.updateArrowsVisibility();
    }
  }

  updateArrowsVisibility() {
    this.showArrows = this.searchResults.length > 0;
  }
}
